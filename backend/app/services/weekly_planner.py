"""LLM-driven weekly planner (Rolling Wave) service."""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import date, timedelta, time
from typing import Dict, List, Set, Tuple
from uuid import UUID

import openai
from sqlalchemy.orm import Session

from app.api.schemas.weekly_plan import MicroResolutionPayload, ResolutionWeeklyStat, SuggestedTaskPayload, WeeklyPlanInputs
from app.db.models.agent_action_log import AgentActionLog
from app.db.models.user import User
from app.db.models.resolution import Resolution
from app.db.models.task import Task
from app.services.availability_profile import availability_prompt_block, sanitize_availability_profile
from app.observability.tracing import trace


@dataclass
class WeeklyPlanPreview:
    week: Tuple[date, date]
    inputs: WeeklyPlanInputs
    micro_resolution: MicroResolutionPayload


@dataclass
class SnapshotResult:
    log: AgentActionLog
    created: bool


def get_weekly_plan_preview(db: Session, user_id: UUID) -> WeeklyPlanPreview:
    """Return a preview of the upcoming week using the LLM-driven planner."""
    week_start, week_end = _upcoming_week_window()
    micro_resolution, inputs = generate_weekly_plan(db, user_id)
    return WeeklyPlanPreview(
        week=(week_start, week_end),
        inputs=inputs,
        micro_resolution=micro_resolution,
    )


def persist_weekly_plan_preview(
    db: Session,
    *,
    user_id: UUID,
    preview: WeeklyPlanPreview | None,
    request_id: str | None,
    force: bool = False,
) -> SnapshotResult:
    """
    Backwards-compatible adapter that persists a snapshot using the Rolling Wave planner.

    The preview argument is ignored because run_weekly_planning_for_user now regenerates the plan
    when persisting to keep the snapshot + generated tasks in sync.
    """
    log = run_weekly_planning_for_user(db, user_id=user_id, force=force, request_id=request_id)
    created = bool(getattr(log, "_rolling_wave_created", True))
    return SnapshotResult(log=log, created=created)


def load_latest_weekly_plan(db: Session, user_id: UUID) -> AgentActionLog | None:
    """Fetch the latest stored weekly plan snapshot for a user."""
    return (
        db.query(AgentActionLog)
        .filter(
            AgentActionLog.user_id == user_id,
            AgentActionLog.action_type == "weekly_plan_generated",
        )
        .order_by(AgentActionLog.created_at.desc())
        .first()
    )


def generate_weekly_plan(
    db: Session,
    user_id: UUID,
    request_id: str | None = None,
) -> Tuple[MicroResolutionPayload, WeeklyPlanInputs]:
    """
    Call the Rolling Wave planner to produce a micro-resolution and suggested tasks.

    Returns both the micro plan and the contextual WeeklyPlanInputs used by response payloads.
    """
    user = db.get(User, user_id)
    if not user:
        raise ValueError("User not found")

    availability_profile = sanitize_availability_profile(getattr(user, "availability_profile", None))
    stats = _collect_weekly_stats(db, user_id)
    focus_resolution = _pick_focus_resolution(stats["resolution_stats"])
    context_summary = _gather_user_context(stats, focus_resolution, availability_profile)
    resolution_models = [
        ResolutionWeeklyStat(**entry)
        for entry in stats["resolution_stats"]
    ]
    trace_metadata = {
        "completion_rate": stats["completion_rate"],
        "active_resolutions": stats["active_resolutions"],
        "primary_focus_resolution_id": str(focus_resolution["resolution_id"]) if focus_resolution else None,
        "llm_input_text": context_summary[:500],
    }
    stats_preview = [
        {
            "title": model.title,
            "domain": model.domain,
            "completion_rate": model.completion_rate,
        }
        for model in resolution_models[:3]
    ]
    if stats_preview:
        trace_metadata["resolution_stats_preview"] = stats_preview

    with trace(
        "weekly_plan.generate",
        metadata={k: v for k, v in trace_metadata.items() if v not in (None, [], "")},
        user_id=str(user_id),
        request_id=request_id,
    ) as planning_trace:
        micro_resolution = _request_plan_from_llm(
            context_summary,
            resolution_models,
            focus_resolution,
            availability_profile,
        )
        if planning_trace and micro_resolution:
            week_titles = [
                task.title for task in (micro_resolution.suggested_week_1_tasks or []) if task.title
            ]
            preview_titles = week_titles[:4]
            summary_text = micro_resolution.title or "Weekly focus"
            if preview_titles:
                summary_text = f"{summary_text} | Week 1: {', '.join(preview_titles)}"
            planning_trace.update(
                metadata={
                    "llm_output_text": summary_text[:500],
                    "week_1_titles": preview_titles,
                }
            )

    inputs = WeeklyPlanInputs(
        active_resolutions=stats["active_resolutions"],
        active_tasks_total=stats["total_tasks"],
        active_tasks_completed=stats["completed_tasks"],
        completion_rate=stats["completion_rate"],
        resolution_stats=resolution_models,
        primary_focus_resolution_id=focus_resolution["resolution_id"] if focus_resolution else None,
    )
    return micro_resolution, inputs


def run_weekly_planning_for_user(
    db: Session,
    user_id: UUID,
    *,
    force: bool = False,
    request_id: str | None = None,
) -> AgentActionLog:
    """
    Execute the Rolling Wave planner, persist the snapshot, and create active tasks.

    Deduplicates by week unless force=True. Returns the AgentActionLog that was reused/created.
    """
    user = db.get(User, user_id)
    if not user:
        raise ValueError("User not found")

    week_start, week_end = _upcoming_week_window()
    week_start_iso = week_start.isoformat()
    week_end_iso = week_end.isoformat()

    if not force:
        existing = _find_existing_snapshot(
            db,
            user_id=user_id,
            action_type="weekly_plan_generated",
            week_start=week_start_iso,
            week_end=week_end_iso,
        )
        if existing:
            setattr(existing, "_rolling_wave_created", False)
            return existing

    micro_resolution, inputs = generate_weekly_plan(db, user_id, request_id=request_id)
    created_tasks = _materialize_tasks_from_plan(db, user_id, micro_resolution, week_start)

    payload = {
        "user_id": str(user_id),
        "week_start": week_start_iso,
        "week_end": week_end_iso,
        "week": {
            "start": week_start_iso,
            "end": week_end_iso,
        },
        "inputs": inputs.model_dump(mode="json"),
        "micro_resolution": micro_resolution.model_dump(),
        "created_task_ids": [str(task.id) for task in created_tasks],
        "request_id": request_id or "",
    }

    log = AgentActionLog(
        user_id=user_id,
        action_type="weekly_plan_generated",
        action_payload=payload,
        reason="Rolling Wave weekly plan generated",
        undo_available=True,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    setattr(log, "_rolling_wave_created", True)
    return log


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _gather_user_context(
    stats: Dict[str, float | int | List[str] | List[Dict[str, object]]],
    focus_resolution: Dict[str, object] | None,
    availability_profile: Dict[str, object],
) -> str:
    """Build a natural-language summary that highlights trends + availability."""
    completion_pct = round(stats["completion_rate"] * 100)
    notes = stats["notes"]
    if notes:
        quoted = "; ".join(f"'{note}'" for note in notes[:3])
        notes_fragment = f"Notes: {quoted}."
    else:
        notes_fragment = "Notes: none recorded."

    resolution_lines: List[str] = []
    resolution_stats: List[Dict[str, object]] = stats.get("resolution_stats", []) or []
    if resolution_stats:
        best = max(resolution_stats, key=lambda entry: entry["completion_rate"])
        worst = min(resolution_stats, key=lambda entry: entry["completion_rate"])
        resolution_lines.append(
            f"Best progress: {best['title']} at {round(best['completion_rate'] * 100)}%."
        )
        if worst["resolution_id"] != best["resolution_id"]:
            resolution_lines.append(
                f"Most at-risk: {worst['title']} at {round(worst['completion_rate'] * 100)}%."
            )
    if focus_resolution:
        focus_pct = round(float(focus_resolution["completion_rate"]) * 100)
        resolution_lines.append(
            f"Primary focus: {focus_resolution['title']} ({focus_pct}% complete, domain={focus_resolution['domain']})."
        )

    availability_hint = availability_prompt_block(focus_resolution["domain"] if focus_resolution else None, availability_profile)
    context = f"User has {stats['active_resolutions']} active goals. Last week completion: {completion_pct}%. {notes_fragment}"
    if resolution_lines:
        context = f"{context} {' '.join(resolution_lines)}"
    if availability_hint:
        context = f"{context}\nAvailability guidance:\n{availability_hint}"
    return context


def _collect_weekly_stats(db: Session, user_id: UUID) -> Dict[str, float | int | List[str] | List[Dict[str, object]]]:
    """Return counts/notes for the trailing seven-day window plus per-resolution stats."""
    today = date.today()
    window_start = today - timedelta(days=6)

    active_resolutions = (
        db.query(Resolution)
        .filter(Resolution.user_id == user_id, Resolution.status == "active")
        .all()
    )
    scheduled_tasks = (
        db.query(Task)
        .filter(
            Task.user_id == user_id,
            Task.scheduled_day.isnot(None),
            Task.scheduled_day >= window_start,
            Task.scheduled_day <= today,
        )
        .all()
    )

    notes: List[str] = []
    total_tasks = 0
    completed_tasks = 0
    tasks_by_resolution: Dict[UUID, List[Task]] = {}
    for task in scheduled_tasks:
        metadata = task.metadata_json or {}
        if metadata.get("draft"):
            continue
        total_tasks += 1
        if (
            task.completed
            and task.completed_at
            and window_start <= task.completed_at.date() <= today
        ):
            completed_tasks += 1
        note = metadata.get("note")
        if isinstance(note, str) and note.strip():
            notes.append(note.strip())
        if task.resolution_id:
            tasks_by_resolution.setdefault(task.resolution_id, []).append(task)

    completion_rate = round((completed_tasks / total_tasks), 2) if total_tasks else 0.0
    resolution_stats: List[Dict[str, object]] = []
    for resolution in active_resolutions:
        res_tasks = tasks_by_resolution.get(resolution.id, [])
        res_total = len(res_tasks)
        res_completed = sum(
            1
            for item in res_tasks
            if item.completed and item.completed_at and window_start <= item.completed_at.date() <= today
        )
        res_completion = round((res_completed / res_total), 2) if res_total else 0.0
        resolution_stats.append(
            {
                "resolution_id": resolution.id,
                "title": resolution.title,
                "domain": (resolution.domain or "personal"),
                "tasks_total": res_total,
                "tasks_completed": res_completed,
                "completion_rate": res_completion,
            }
        )

    return {
        "active_resolutions": len(active_resolutions),
        "total_tasks": total_tasks,
        "completed_tasks": completed_tasks,
        "completion_rate": completion_rate,
        "notes": notes,
        "resolution_stats": resolution_stats,
    }


def _pick_focus_resolution(resolution_stats: List[Dict[str, object]]) -> Dict[str, object] | None:
    """Return the most at-risk resolution (completion < 80%) if available."""
    if not resolution_stats:
        return None
    eligible = [stat for stat in resolution_stats if stat.get("tasks_total", 0) > 0]
    if not eligible:
        eligible = resolution_stats
    eligible = sorted(eligible, key=lambda entry: entry["completion_rate"])
    candidate = eligible[0]
    if candidate["completion_rate"] >= 0.8:
        return None
    return candidate


def _request_plan_from_llm(
    context_summary: str,
    resolution_stats: List[ResolutionWeeklyStat],
    focus_resolution: Dict[str, object] | None,
    availability_profile: Dict[str, object] | None,
) -> MicroResolutionPayload:
    """Call OpenAI with the specified prompts or fall back safely."""
    api_key = os.environ.get("OPENAI_API_KEY")
    focus_title = focus_resolution["title"] if focus_resolution else None
    if not api_key:
        return _fallback_micro_resolution(focus_title)

    client = openai.OpenAI(api_key=api_key)
    serialized_stats = json.dumps(
        [
            {
                **stat.model_dump(),
                "resolution_id": str(stat.resolution_id),
            }
            for stat in resolution_stats
        ]
    )
    availability_hint = availability_prompt_block(
        focus_resolution["domain"] if focus_resolution else None,
        availability_profile or {},
    )
    system_prompt = (
        "You are Sarthi AI, a strategic coach. Review the user's last week and design the next. "
        "If they struggled (<50%), simplify and focus on consistency. "
        "If they crushed it (>80%), gently increase intensity or variety."
    )
    user_prompt = (
        f"Context: {context_summary}\n"
        f"Resolution stats JSON: {serialized_stats}\n"
        f"Availability guidance: {availability_hint or 'standard working hours'}\n"
        "Focus on the lowest-performing resolution unless all are above 80% completion.\n"
        "Generate a 'Micro-Resolution' JSON object with keys 'title', 'why_this', "
        "and 'suggested_week_1_tasks'. Include 3-5 specific tasks for the upcoming week. "
        "Each task must contain 'title', 'duration_min' (integer minutes), "
        "and 'suggested_time' (morning, afternoon, or evening)."
    )

    try:
        completion = client.chat.completions.create(
            model="gpt-4o",
            response_format={"type": "json_object"},
            temperature=0.6,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
        content = completion.choices[0].message.content or "{}"
        payload = json.loads(content)
        micro = MicroResolutionPayload.model_validate(payload)
        return _ensure_task_bounds(micro)
    except Exception:
        return _fallback_micro_resolution(focus_title)


def _fallback_micro_resolution(focus_title: str | None = None) -> MicroResolutionPayload:
    """Deterministic fallback when the LLM call fails."""
    title = f"Reset Week: {focus_title}" if focus_title else "Reset Week"
    return MicroResolutionPayload(
        title=title,
        why_this="Lighten the load, rebuild confidence, and carry momentum into the following week.",
        suggested_week_1_tasks=[
            SuggestedTaskPayload(title="Schedule three 30-min focus blocks", duration_min=30, suggested_time="morning"),
            SuggestedTaskPayload(title="One midweek reflection note", duration_min=10, suggested_time="evening"),
            SuggestedTaskPayload(title="Weekend reset + planning ritual", duration_min=25, suggested_time="afternoon"),
        ],
    )


def _ensure_task_bounds(micro: MicroResolutionPayload) -> MicroResolutionPayload:
    """Clamp task count to 3-5 entries, padding with fallback tasks if needed."""
    tasks = list(micro.suggested_week_1_tasks or [])
    fallback_tasks = _fallback_micro_resolution().suggested_week_1_tasks
    idx = 0
    while len(tasks) < 3 and idx < len(fallback_tasks):
        tasks.append(fallback_tasks[idx])
        idx += 1
    if len(tasks) > 5:
        tasks = tasks[:5]

    return MicroResolutionPayload(
        title=micro.title or "Momentum Week",
        why_this=micro.why_this or "Keep the cadence gentle while sustaining visible progress.",
        suggested_week_1_tasks=tasks,
    )


def _materialize_tasks_from_plan(
    db: Session,
    user_id: UUID,
    micro_resolution: MicroResolutionPayload,
    week_start: date,
) -> List[Task]:
    """Create concrete Task rows from the suggested payload."""
    created: List[Task] = []
    suggestions = micro_resolution.suggested_week_1_tasks or []
    week_end = week_start + timedelta(days=6)
    occupied = _load_existing_schedule_map(db, user_id, week_start, week_end)
    for index, suggestion in enumerate(suggestions):
        requested_day = week_start + timedelta(days=index % 7)
        requested_time = _map_suggested_time(suggestion.suggested_time)
        scheduled_day, scheduled_time = _reserve_available_slot(
            requested_day,
            requested_time,
            occupied,
            week_start,
            week_end,
        )
        metadata = {
            "draft": False,
            "source": "rolling_wave",
            "micro_resolution_title": micro_resolution.title,
            "suggested_time": suggestion.suggested_time,
        }
        duration_minutes = suggestion.duration_min or 30
        task = Task(
            user_id=user_id,
            resolution_id=None,
            title=suggestion.title,
            duration_min=duration_minutes,
            scheduled_day=scheduled_day,
            scheduled_time=scheduled_time,
            metadata_json=metadata,
            completed=False,
            completed_at=None,
        )
        db.add(task)
        created.append(task)

    db.flush()
    return created


def _map_suggested_time(label: str | None) -> time | None:
    """Translate coarse labels to representative times."""
    if not label:
        return None
    label = label.lower()
    if label == "morning":
        return time(hour=9, minute=0)
    if label == "afternoon":
        return time(hour=13, minute=0)
    if label == "evening":
        return time(hour=19, minute=0)
    return None


def _load_existing_schedule_map(db: Session, user_id: UUID, week_start: date, week_end: date) -> Dict[date, Set[time]]:
    rows = (
        db.query(Task)
        .filter(
            Task.user_id == user_id,
            Task.scheduled_day.isnot(None),
            Task.scheduled_day >= week_start,
            Task.scheduled_day <= week_end,
        )
        .all()
    )
    occupied: Dict[date, Set[time]] = {}
    for row in rows:
        metadata = row.metadata_json or {}
        if metadata.get("draft"):
            continue
        if row.scheduled_day and row.scheduled_time:
            occupied.setdefault(row.scheduled_day, set()).add(row.scheduled_time)
    return occupied


def _reserve_available_slot(
    requested_day: date,
    requested_time: time | None,
    occupied: Dict[date, Set[time]],
    week_start: date,
    week_end: date,
) -> Tuple[date, time | None]:
    if requested_time is None:
        return requested_day, None

    total_days = (week_end - week_start).days + 1
    time_choices = _time_preferences(requested_time)

    for day_offset in range(total_days):
        candidate_day = requested_day + timedelta(days=day_offset)
        if candidate_day > week_end:
            candidate_day = week_start + timedelta(days=(candidate_day - week_start).days % total_days)
        used = occupied.setdefault(candidate_day, set())
        for slot in time_choices:
            if slot not in used:
                used.add(slot)
                return candidate_day, slot

    # Fallback: every slot is occupied, return the original to avoid dropping the task.
    return requested_day, requested_time


def _time_preferences(preferred: time) -> List[time]:
    """Return a deterministic ordering of preferred times to try."""
    anchors = [
        time(hour=9, minute=0),
        time(hour=13, minute=0),
        time(hour=19, minute=0),
    ]
    ordered = [preferred]
    for anchor in anchors:
        if anchor not in ordered:
            ordered.append(anchor)
    return ordered


def _upcoming_week_window(base: date | None = None) -> Tuple[date, date]:
    """Return the next Monday-start week window."""
    today = base or date.today()
    days_until_monday = (7 - today.weekday()) % 7 or 7
    week_start = today + timedelta(days=days_until_monday)
    return week_start, week_start + timedelta(days=6)


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
