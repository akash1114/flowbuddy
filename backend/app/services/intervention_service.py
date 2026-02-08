"""Basic intervention preview service."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, time, timezone
from typing import Dict, List, Tuple
from uuid import UUID

import openai
from sqlalchemy.orm import Session

from app.api.schemas.interventions import InterventionCard, InterventionOption, SlippagePayload
from app.db.models.agent_action_log import AgentActionLog
from app.db.models.user import User
from app.db.models.task import Task
from app.db.models.resolution import Resolution
from app.core.config import settings
from zoneinfo import ZoneInfo
from app.observability.tracing import trace


@dataclass
class InterventionPreview:
    week: Tuple[date, date]
    slippage: SlippagePayload
    card: InterventionCard | None


@dataclass
class SnapshotResult:
    log: AgentActionLog
    created: bool


OPTION_ALIASES = {
    "get_back_on_track": "reschedule",
    "adjust_goal": "reduce_scope",
    "pause": "reflect",
}


def get_intervention_preview(db: Session, user_id: UUID) -> InterventionPreview:
    today = date.today()
    current_week_start = today - timedelta(days=today.weekday())
    current_week_end = current_week_start + timedelta(days=6)

    tasks = (
        db.query(Task)
        .filter(Task.user_id == user_id)
        .all()
    )
    stats = _collect_slippage_stats(tasks)
    flagged, reason = _determine_slippage(stats)

    card = _determine_intervention_card(stats) if flagged else None

    slippage_payload = SlippagePayload(
        flagged=flagged,
        reason=reason,
        completion_rate=stats["completion_rate"],
        missed_scheduled=stats["missed_scheduled"],
    )

    return InterventionPreview(
        week=(current_week_start, current_week_end),
        slippage=slippage_payload,
        card=card,
    )


def persist_intervention_preview(
    db: Session,
    *,
    user_id: UUID,
    preview: InterventionPreview,
    request_id: str | None,
    force: bool = False,
) -> SnapshotResult:
    user = db.get(User, user_id)
    if not user:
        raise ValueError("User not found")

    week_start_iso = preview.week[0].isoformat()
    week_end_iso = preview.week[1].isoformat()
    if not force:
        existing = _find_existing_snapshot(
            db,
            user_id=user_id,
            action_type="intervention_generated",
            week_start=week_start_iso,
            week_end=week_end_iso,
        )
        if existing:
            if _apply_preview_to_existing_log(existing, preview, request_id):
                db.add(existing)
                db.commit()
                db.refresh(existing)
            return SnapshotResult(log=existing, created=False)

    payload = {
        "user_id": str(user_id),
        "week_start": week_start_iso,
        "week_end": week_end_iso,
        "week": {"start": week_start_iso, "end": week_end_iso},
        "slippage": preview.slippage.model_dump(),
        "card": preview.card.model_dump() if preview.card else None,
        "request_id": request_id or "",
    }
    log = AgentActionLog(
        user_id=user_id,
        action_type="intervention_generated",
        action_payload=payload,
        reason="Intervention generated",
        undo_available=True,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return SnapshotResult(log=log, created=True)


def load_latest_intervention(db: Session, user_id: UUID) -> AgentActionLog | None:
    return (
        db.query(AgentActionLog)
        .filter(
            AgentActionLog.user_id == user_id,
            AgentActionLog.action_type == "intervention_generated",
        )
        .order_by(AgentActionLog.created_at.desc())
        .first()
    )


def _find_existing_snapshot(
    db: Session,
    *,
    user_id: UUID,
    action_type: str,
    week_start: str,
    week_end: str,
) -> AgentActionLog | None:
    logs = (
        db.query(AgentActionLog)
        .filter(AgentActionLog.user_id == user_id, AgentActionLog.action_type == action_type)
        .order_by(AgentActionLog.created_at.desc())
        .limit(100)
        .all()
    )
    for log in logs:
        payload = log.action_payload or {}
        if payload.get("week_start") == week_start and payload.get("week_end") == week_end:
            return log
    return None


def _collect_slippage_stats(tasks: List[Task]) -> Dict[str, float | int]:
    now = datetime.now(ZoneInfo(settings.scheduler_timezone))
    today = now.date()
    window_start = today - timedelta(days=6)

    relevant_tasks: List[Task] = []
    for task in tasks:
        if _is_draft(task):
            continue
        task_date = task.scheduled_day or (task.created_at.date() if task.created_at else None)
        if task_date and window_start <= task_date <= today:
            relevant_tasks.append(task)

    total = len(relevant_tasks)
    completed = sum(
        1
        for task in relevant_tasks
        if task.completed and task.completed_at and window_start <= task.completed_at.date() <= today
    )
    completion_rate = round((completed / total) if total else 0.0, 2)

    missed_scheduled = sum(1 for task in relevant_tasks if _task_is_past_due(task, now))

    return {
        "total": total,
        "completed": completed,
        "completion_rate": completion_rate,
        "missed_scheduled": missed_scheduled,
    }


def _determine_slippage(stats: Dict[str, float | int]) -> Tuple[bool, str]:
    completion_rate = stats["completion_rate"]
    missed = stats["missed_scheduled"]

    if completion_rate < 0.4:
        return True, "Completion dipped below 40% over the last 7 days."
    if missed >= 2:
        return True, "Multiple scheduled tasks were missed this week."
    return False, "Looks on track. Keep the gentle cadence."


def _determine_intervention_card(stats: Dict[str, float | int]) -> InterventionCard:
    """Use Sarathi AI to craft a personalized intervention or fall back to heuristics."""
    completion_pct = int((stats.get("completion_rate") or 0) * 100)
    missed = int(stats.get("missed_scheduled") or 0)
    total = int(stats.get("total") or 0)
    llm_input = (
        f"User missed {missed} scheduled tasks out of {total}. "
        f"Completion rate last 7 days: {completion_pct}%. "
        "Provide a supportive intervention card with three options."
    )
    trace_metadata = {
        "llm_input_text": llm_input[:500],
        "completion_rate": stats.get("completion_rate"),
        "missed_scheduled": missed,
        "total_tasks": total,
    }

    api_key = os.environ.get("OPENAI_API_KEY")
    with trace(
        "intervention.generate",
        metadata={k: v for k, v in trace_metadata.items() if v not in (None, "", [])},
    ) as intervention_trace:
        if not api_key:
            card = _build_card(stats)
            if intervention_trace:
                intervention_trace.update(_summarize_card_for_trace(card))
            return card

        client = openai.OpenAI(api_key=api_key)
    system_prompt = (
        "You are Sarathi AI. The user is struggling. Analyze the data and generate a supportive intervention card "
        "with 3 distinct options. Offer one for getting back on track, one for adjusting the goal, and one for pausing."
    )
    user_prompt = (
        f"User missed {missed} scheduled tasks out of {total}. "
        f"Completion rate last 7 days: {completion_pct}%. "
        "Return JSON that matches the InterventionCard schema with fields title, message, and "
        "options (array of {key,label,details}). Keep advice kind and actionable."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            response_format={"type": "json_object"},
            temperature=0.4,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        content = response.choices[0].message.content or "{}"
        payload = json.loads(content)
        llm_card = InterventionCard.model_validate(payload)
        card = InterventionCard(
            title=llm_card.title or "Let's Adjust This Week",
            message=llm_card.message
            or _default_message(stats.get("completion_rate"), stats.get("missed_scheduled")),
            options=llm_card.options or _standard_options(),
        )
    except Exception:
        card = _build_card(stats)

    if intervention_trace:
        intervention_trace.update(_summarize_card_for_trace(card))
    return card


def _build_card(stats: Dict[str, float | int]) -> InterventionCard:
    completion_rate = stats["completion_rate"]
    missed = stats["missed_scheduled"]
    return InterventionCard(
        title="Let's Adjust This Week",
        message=_default_message(completion_rate, missed),
        options=_standard_options(),
    )


def _default_message(completion_rate: float | int, missed: float | int) -> str:
    pct = int((completion_rate or 0) * 100)
    missed_value = int(missed or 0)
    return (
        "I'm noticing progress is light "
        f"(completion {pct}%, missed {missed_value}). Which support feels best?"
    )


def _standard_options() -> List[InterventionOption]:
    return [
        InterventionOption(
            key="reduce_scope",
            label="Reduce Scope",
            details="We'll trim the number of tasks or shorten durations so the week feels lighter.",
        ),
        InterventionOption(
            key="reschedule",
            label="Reschedule",
            details="Move the remaining tasks to the days/times you usually have more energy.",
        ),
        InterventionOption(
            key="reflect",
            label="Reflect",
            details="Pause to jot one sentence on what's blocking you. I’ll adapt next week’s plan.",
        ),
    ]


def _is_draft(task: Task) -> bool:
    metadata = task.metadata_json or {}
    return bool(metadata.get("draft"))


def _task_is_past_due(task: Task, reference: datetime) -> bool:
    if task.completed:
        return False
    due_day = task.scheduled_day
    due_time = task.scheduled_time
    if due_day:
        scheduled_time = due_time or time(hour=23, minute=59, second=0)
        due_dt = datetime.combine(due_day, scheduled_time)
    elif task.created_at:
        created = task.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=reference.tzinfo)
        due_dt = created
    else:
        return False

    if due_dt.tzinfo is None:
        due_dt = due_dt.replace(tzinfo=reference.tzinfo)
    else:
        due_dt = due_dt.astimezone(reference.tzinfo)

    # Tasks with times later today are not overdue yet
    return due_dt <= reference


def _summarize_card_for_trace(card: InterventionCard) -> Dict[str, Any]:
    summary = card.title or "Intervention"
    if card.message:
        summary = f"{summary}: {card.message}"
    option_labels = [option.label for option in card.options or []]
    return {
        "llm_output_text": summary[:500],
        "option_labels": option_labels,
    }


def _apply_preview_to_existing_log(log: AgentActionLog, preview: InterventionPreview, request_id: str | None) -> bool:
    """Merge the latest preview data into an existing log when a weekly snapshot already exists."""
    payload = dict(log.action_payload or {})
    updated = False
    new_slippage = preview.slippage.model_dump()
    new_card = preview.card.model_dump() if preview.card else None

    if payload.get("slippage") != new_slippage:
        payload["slippage"] = new_slippage
        updated = True
    if payload.get("card") != new_card:
        payload["card"] = new_card
        updated = True
    if updated:
        payload["request_id"] = request_id or payload.get("request_id") or ""
        payload["week_start"] = preview.week[0].isoformat()
        payload["week_end"] = preview.week[1].isoformat()
        payload["week"] = {"start": payload["week_start"], "end": payload["week_end"]}
        log.action_payload = payload
        log.reason = "Intervention updated"
    return updated


def execute_intervention_option(db: Session, user_id: UUID, option_key: str) -> Dict[str, Any]:
    """Execute a follow-up action for an intervention selection."""
    normalized = (option_key or "").strip().lower()
    canonical = OPTION_ALIASES.get(normalized, normalized)
    normalized = canonical
    if normalized == "reduce_scope":
        return _execute_reduce_scope(db, user_id)
    if normalized == "reschedule":
        return _execute_reschedule(db, user_id)
    if normalized == "reflect":
        return _execute_reflect(db, user_id)
    return {"message": "Option applied.", "changes": []}


def _execute_reduce_scope(db: Session, user_id: UUID) -> Dict[str, Any]:
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user_id,
            Task.completed.is_(False),
        )
        .order_by(
            Task.scheduled_day.is_(None),
            Task.scheduled_day.asc(),
            Task.scheduled_time.asc(),
            Task.created_at.asc(),
        )
        .all()
    )
    updated = 0
    changes: List[str] = []
    now = datetime.now(timezone.utc)
    for task in tasks:
        if updated >= 2:
            break
        if _is_draft(task):
            continue
        metadata = dict(task.metadata_json or {})
        metadata.update(
            {
                "status": "skipped",
                "reason": "intervention_reduced",
                "intervention_updated_at": now.isoformat(),
            }
        )
        task.metadata_json = metadata
        task.completed = True
        task.completed_at = now
        db.add(task)
        updated += 1
        when = task.scheduled_day.isoformat() if task.scheduled_day else "unscheduled"
        changes.append(f"Marked “{task.title}” complete (was scheduled {when}).")
    if updated:
        db.commit()
    message = "I've cleared your next 2 tasks. Breathe easy." if updated else "No additional tasks needed clearing."
    return {"message": message, "changes": changes}


def _execute_reschedule(db: Session, user_id: UUID) -> Dict[str, Any]:
    today = date.today()
    window_end = today + timedelta(days=6)
    tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user_id,
            Task.completed.is_(False),
            Task.scheduled_day.isnot(None),
            Task.scheduled_day <= window_end,
        )
        .all()
    )
    shifted = 0
    changes: List[str] = []
    for task in tasks:
        if _is_draft(task):
            continue
        original_day = task.scheduled_day
        if not original_day:
            continue
        anchor = original_day if original_day >= today else today
        task.scheduled_day = anchor + timedelta(days=2)
        metadata = dict(task.metadata_json or {})
        metadata["intervention_updated_at"] = datetime.now(timezone.utc).isoformat()
        metadata["reason"] = "intervention_rescheduled"
        task.metadata_json = metadata
        db.add(task)
        shifted += 1
        new_day = task.scheduled_day.isoformat()
        changes.append(f"Moved “{task.title}” from {original_day.isoformat()} to {new_day}.")
    if shifted:
        db.commit()
    message = "Moved your schedule forward by 2 days." if shifted else "No scheduled tasks were available to shift."
    return {"message": message, "changes": changes}


def _execute_reflect(db: Session, user_id: UUID) -> Dict[str, Any]:
    tomorrow = date.today() + timedelta(days=1)
    resolution = (
        db.query(Resolution)
        .filter(Resolution.user_id == user_id, Resolution.status == "active")
        .order_by(Resolution.updated_at.desc())
        .first()
    )
    metadata = {
        "draft": False,
        "source": "intervention_reflect",
    }
    reflect_task = Task(
        user_id=user_id,
        resolution_id=resolution.id if resolution else None,
        title="5-min Reflection",
        duration_min=5,
        scheduled_day=tomorrow,
        scheduled_time=time(hour=9, minute=0),
        metadata_json=metadata,
        completed=False,
    )
    db.add(reflect_task)
    db.commit()
    when = tomorrow.isoformat()
    return {
        "message": "Added a short reflection task for tomorrow.",
        "changes": [f"Added “{reflect_task.title}” on {when} at 09:00."],
    }
