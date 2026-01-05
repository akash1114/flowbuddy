"""Aggregation helpers for dashboard endpoint."""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import List
from uuid import UUID

from sqlalchemy import asc, desc
from sqlalchemy.orm import Session

from app.api.schemas.dashboard import (
    DashboardResolution,
    RecentActivity,
    TaskStats,
    WeekWindow,
)
from app.db.models.resolution import Resolution
from app.db.models.task import Task


def _week_window(today: date) -> WeekWindow:
    start = today - timedelta(days=today.weekday())
    end = start + timedelta(days=6)
    return WeekWindow(start=start, end=end)


def _is_draft(task: Task) -> bool:
    metadata = task.metadata_json or {}
    return bool(metadata.get("draft"))


def _note_present(task: Task) -> bool:
    metadata = task.metadata_json or {}
    note = metadata.get("note")
    return isinstance(note, str) and bool(note.strip())


def get_dashboard_data(db: Session, user_id: UUID) -> List[DashboardResolution]:
    today = date.today()
    week = _week_window(today)

    resolutions = (
        db.query(Resolution)
        .filter(Resolution.user_id == user_id, Resolution.status == "active")
        .order_by(desc(Resolution.updated_at))
        .all()
    )

    entries: List[DashboardResolution] = []
    for resolution in resolutions:
        tasks = (
            db.query(Task)
            .filter(Task.user_id == user_id, Task.resolution_id == resolution.id)
            .order_by(asc(Task.created_at))
            .all()
        )
        active_tasks = [task for task in tasks if not _is_draft(task)]

        total = len(active_tasks)
        completed = sum(1 for task in active_tasks if task.completed)
        scheduled = sum(
            1
            for task in active_tasks
            if task.scheduled_day and week.start <= task.scheduled_day <= week.end
        )
        unscheduled = total - scheduled
        completion_rate = (completed / total) if total else 0.0

        recent = (
            db.query(Task)
            .filter(Task.user_id == user_id, Task.resolution_id == resolution.id)
            .order_by(desc(Task.updated_at), desc(Task.created_at))
            .limit(5)
            .all()
        )
        recent_activity = [
            RecentActivity(
                task_id=task.id,
                title=task.title,
                completed=bool(task.completed),
                completed_at=task.completed_at,
                note_present=_note_present(task),
            )
            for task in recent
        ]

        entries.append(
            DashboardResolution(
                resolution_id=resolution.id,
                title=resolution.title,
                type=resolution.type,
                duration_weeks=resolution.duration_weeks,
                status=resolution.status,
                week=week,
                tasks=TaskStats(
                    total=total,
                    completed=completed,
                    scheduled=scheduled,
                    unscheduled=unscheduled,
                ),
                completion_rate=completion_rate,
                recent_activity=recent_activity,
            )
        )

    return entries
