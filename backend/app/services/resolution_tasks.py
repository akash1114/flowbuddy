"""Helpers for working with resolution tasks."""
from __future__ import annotations

from typing import Dict, List
from uuid import UUID

from sqlalchemy.orm import Session

from app.api.schemas.approval import ApprovedTaskPayload, TaskEdit
from app.api.schemas.decomposition import DraftTaskPayload
from app.db.models.task import Task
from app.services.resolution_decomposer import DraftTaskSpec


def fetch_draft_tasks(db: Session, resolution_id: UUID) -> List[Task]:
    tasks = (
        db.query(Task)
        .filter(Task.resolution_id == resolution_id)
        .order_by(Task.created_at.asc())
        .all()
    )
    return [task for task in tasks if is_draft_task(task)]


def fetch_active_tasks(db: Session, resolution_id: UUID) -> List[Task]:
    tasks = (
        db.query(Task)
        .filter(Task.resolution_id == resolution_id)
        .order_by(Task.created_at.asc())
        .all()
    )
    return [task for task in tasks if is_active_task(task)]


def delete_existing_draft_tasks(db: Session, resolution_id: UUID) -> None:
    tasks = fetch_draft_tasks(db, resolution_id)
    for task in tasks:
        db.delete(task)
    if tasks:
        db.flush()


def is_draft_task(task: Task) -> bool:
    metadata = task.metadata_json or {}
    return bool(metadata.get("draft")) and metadata.get("source") == "decomposer_v1"


def is_active_task(task: Task) -> bool:
    metadata = task.metadata_json or {}
    return metadata.get("draft") is False and metadata.get("source") == "decomposer_v1"


def create_tasks_from_specs(resolution, specs: List[DraftTaskSpec]) -> List[Task]:
    tasks: List[Task] = []
    for spec in specs:
        extra_metadata = {k: v for k, v in (spec.metadata or {}).items() if v is not None}
        metadata = {"draft": True, "source": "decomposer_v1", "week": 1, **extra_metadata}
        task = Task(
            user_id=resolution.user_id,
            resolution_id=resolution.id,
            title=spec.title,
            scheduled_day=spec.scheduled_day,
            scheduled_time=spec.scheduled_time,
            duration_min=spec.duration_min,
            metadata_json=metadata,
        )
        tasks.append(task)
    return tasks


def serialize_draft_task(task: Task) -> DraftTaskPayload:
    return DraftTaskPayload(
        id=task.id,
        title=task.title,
        scheduled_day=task.scheduled_day,
        scheduled_time=task.scheduled_time,
        duration_min=task.duration_min,
        draft=True,
    )


def serialize_active_task(task: Task) -> ApprovedTaskPayload:
    return ApprovedTaskPayload(
        id=task.id,
        title=task.title,
        scheduled_day=task.scheduled_day,
        scheduled_time=task.scheduled_time,
        duration_min=task.duration_min,
        draft=False,
    )


def activate_tasks(tasks: List[Task], activated_at: str) -> None:
    for task in tasks:
        metadata = dict(task.metadata_json or {})
        metadata["draft"] = False
        metadata["activated_at"] = activated_at
        task.metadata_json = metadata
        task.completed = False
        task.completed_at = None


def apply_task_edits(tasks_map: Dict[UUID, Task], edits: List[TaskEdit]) -> int:
    edited: set[UUID] = set()
    for edit in edits:
        task = tasks_map.get(edit.task_id)
        if not task:
            continue
        mutated = False
        if edit.title is not None and edit.title != task.title:
            task.title = edit.title
            mutated = True
        if edit.scheduled_day is not None and edit.scheduled_day != task.scheduled_day:
            task.scheduled_day = edit.scheduled_day
            mutated = True
        if edit.scheduled_time is not None and edit.scheduled_time != task.scheduled_time:
            task.scheduled_time = edit.scheduled_time
            mutated = True
        if edit.duration_min is not None and edit.duration_min != task.duration_min:
            task.duration_min = edit.duration_min
            mutated = True
        if mutated:
            edited.add(task.id)
    return len(edited)
