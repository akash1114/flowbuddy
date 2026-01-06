"""Basic intervention preview service."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Dict, List, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.schemas.interventions import InterventionCard, InterventionOption, SlippagePayload
from app.db.models.agent_action_log import AgentActionLog
from app.db.models.user import User
from app.db.models.task import Task


@dataclass
class InterventionPreview:
    week: Tuple[date, date]
    slippage: SlippagePayload
    card: InterventionCard | None


@dataclass
class SnapshotResult:
    log: AgentActionLog
    created: bool


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

    card = _build_card(stats) if flagged else None

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
        .all()
    )
    for log in logs:
        payload = log.action_payload or {}
        if payload.get("week_start") == week_start and payload.get("week_end") == week_end:
            return log
    return None


def _collect_slippage_stats(tasks: List[Task]) -> Dict[str, float | int]:
    today = date.today()
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

    missed_scheduled = sum(
        1
        for task in relevant_tasks
        if task.scheduled_day
        and task.scheduled_day <= today
        and not task.completed
    )

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


def _build_card(stats: Dict[str, float | int]) -> InterventionCard:
    completion_rate = stats["completion_rate"]
    missed = stats["missed_scheduled"]
    title = "Let's Adjust This Week"
    message = (
        "I'm noticing progress is light"
        f" (completion {int(completion_rate * 100)}%, missed {missed}). Which support feels best?"
    )

    options = [
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
    return InterventionCard(title=title, message=message, options=options)


def _is_draft(task: Task) -> bool:
    metadata = task.metadata_json or {}
    return bool(metadata.get("draft"))
