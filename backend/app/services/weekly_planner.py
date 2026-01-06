"""Heuristic weekly planner preview service."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Dict, List, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.schemas.weekly_plan import MicroResolutionPayload, SuggestedTaskPayload, WeeklyPlanInputs
from app.db.models.agent_action_log import AgentActionLog
from app.db.models.user import User
from app.db.models.resolution import Resolution
from app.db.models.task import Task


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
    today = date.today()
    next_week_start = today + timedelta(days=(7 - today.weekday()) % 7 or 7)
    next_week_end = next_week_start + timedelta(days=6)

    active_resolutions = (
        db.query(Resolution)
        .filter(Resolution.user_id == user_id, Resolution.status == "active")
        .all()
    )

    tasks = (
        db.query(Task)
        .filter(Task.user_id == user_id)
        .all()
    )
    recent_stats = _collect_recent_stats(tasks)
    completion_rate = recent_stats["completion_rate"]

    micro_resolution = _build_micro_resolution(
        completion_rate=completion_rate,
        active_resolutions=active_resolutions,
        notes=recent_stats["notes"],
    )

    inputs = WeeklyPlanInputs(
        active_resolutions=len(active_resolutions),
        active_tasks_total=recent_stats["total"],
        active_tasks_completed=recent_stats["completed"],
        completion_rate=completion_rate,
    )

    return WeeklyPlanPreview(
        week=(next_week_start, next_week_end),
        inputs=inputs,
        micro_resolution=micro_resolution,
    )


def persist_weekly_plan_preview(
    db: Session,
    *,
    user_id: UUID,
    preview: WeeklyPlanPreview,
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
            action_type="weekly_plan_generated",
            week_start=week_start_iso,
            week_end=week_end_iso,
        )
        if existing:
            return SnapshotResult(log=existing, created=False)

    payload = {
        "user_id": str(user_id),
        "week_start": week_start_iso,
        "week_end": week_end_iso,
        "week": {
            "start": week_start_iso,
            "end": week_end_iso,
        },
        "inputs": preview.inputs.model_dump(),
        "micro_resolution": preview.micro_resolution.model_dump(),
        "request_id": request_id or "",
    }

    log = AgentActionLog(
        user_id=user_id,
        action_type="weekly_plan_generated",
        action_payload=payload,
        reason="Weekly plan generated",
        undo_available=True,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return SnapshotResult(log=log, created=True)


def load_latest_weekly_plan(db: Session, user_id: UUID) -> AgentActionLog | None:
    return (
        db.query(AgentActionLog)
        .filter(
            AgentActionLog.user_id == user_id,
            AgentActionLog.action_type == "weekly_plan_generated",
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


def _collect_recent_stats(tasks: List[Task]) -> Dict[str, float | int | List[str]]:
    today = date.today()
    window_start = today - timedelta(days=6)

    active_tasks: List[Task] = []
    for task in tasks:
        if _is_draft(task):
            continue
        task_date = task.scheduled_day or (task.created_at.date() if task.created_at else None)
        if task_date and window_start <= task_date <= today:
            active_tasks.append(task)

    total = len(active_tasks)
    completed = sum(
        1
        for task in active_tasks
        if task.completed and task.completed_at and window_start <= task.completed_at.date() <= today
    )
    completion_rate = (completed / total) if total else 0.0

    notes = []
    for task in active_tasks:
        metadata = task.metadata_json or {}
        note = metadata.get("note")
        if isinstance(note, str) and note.strip():
            notes.append(note.strip())

    return {
        "total": total,
        "completed": completed,
        "completion_rate": round(completion_rate, 2),
        "notes": notes,
    }


def _build_micro_resolution(*, completion_rate: float, active_resolutions: List[Resolution], notes: List[str]) -> MicroResolutionPayload:
    note_hint = notes[0] if notes else ""
    time_hint = _infer_time_hint(notes)
    suggested_tasks = _build_suggested_tasks(time_hint)

    if not active_resolutions:
        title = "Gentle Momentum Week"
        why = "Let's pick one light focus to keep your intentions warm even without active plans."
    elif completion_rate >= 0.7:
        title = "Stretch & Celebrate"
        why = "You completed most of last week's tasks. Let's add one small stretch goal that still feels kind."
    elif completion_rate >= 0.4:
        title = "Steady Foundations"
        why = "You're halfway there. This week centres on rituals that make progress repeatable."
    else:
        blocker = note_hint or "energy dips"
        title = "Soft Restart Week"
        why = f"Completion dipped recently, so we focus on tiny wins and clearing {blocker.lower()}."

    return MicroResolutionPayload(
        title=title,
        why_this=why,
        suggested_week_1_tasks=suggested_tasks,
    )


def _build_suggested_tasks(time_hint: str | None) -> List[SuggestedTaskPayload]:
    suggested_time = time_hint or "morning"
    return [
        SuggestedTaskPayload(
            title="Name the single focus for the week",
            duration_min=10,
            suggested_time=suggested_time,
        ),
        SuggestedTaskPayload(
            title="Book a 20-min check-in with yourself",
            duration_min=20,
            suggested_time="evening" if suggested_time == "morning" else "morning",
        ),
        SuggestedTaskPayload(
            title="Capture one blocker + one win",
            duration_min=5,
            suggested_time=None,
        ),
    ]


def _infer_time_hint(notes: List[str]) -> str | None:
    lowered = " ".join(notes).lower()
    if any(keyword in lowered for keyword in ("morning", "sunrise", "am")):
        return "morning"
    if any(keyword in lowered for keyword in ("evening", "night", "pm")):
        return "evening"
    return None


def _is_draft(task: Task) -> bool:
    metadata = task.metadata_json or {}
    return bool(metadata.get("draft"))
