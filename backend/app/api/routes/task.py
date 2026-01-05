"""Task listing API routes."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import asc, nulls_last
from sqlalchemy.orm import Session

from app.api.schemas.task import (
    TaskSummary,
    TaskUpdateRequest,
    TaskUpdateResponse,
    TaskNoteUpdateRequest,
    TaskNoteUpdateResponse,
)
from app.db.deps import get_db
from app.db.models.agent_action_log import AgentActionLog
from app.db.models.task import Task
from app.observability.metrics import log_metric
from app.observability.tracing import trace

router = APIRouter()


@router.get("/tasks", response_model=List[TaskSummary], tags=["tasks"])
def list_tasks(
    http_request: Request,
    user_id: UUID = Query(..., description="User ID owning the tasks"),
    status: str = Query("active", pattern="^(active|draft|all)$"),
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
) -> List[TaskSummary]:
    """List tasks for a user with optional status and date filtering."""
    request_id = getattr(http_request.state, "request_id", None)

    metadata: Dict[str, Any] = {
        "route": "/tasks",
        "user_id": str(user_id),
        "status": status,
        "from": from_.isoformat() if from_ else None,
        "to": to.isoformat() if to else None,
        "request_id": request_id,
    }

    start_tasks: List[Task] = []
    with trace(
        "task.list",
        metadata=metadata,
        user_id=str(user_id),
        request_id=request_id,
    ):
        query = db.query(Task).filter(Task.user_id == user_id)

        tasks = query.order_by(
            nulls_last(asc(Task.scheduled_day)),
            nulls_last(asc(Task.scheduled_time)),
            asc(Task.created_at),
        ).all()

        if status == "draft":
            start_tasks = [task for task in tasks if _is_draft_task(task)]
        elif status == "active":
            start_tasks = [task for task in tasks if not _is_draft_task(task)]
        else:
            start_tasks = tasks

        if from_:
            start_tasks = [
                task for task in start_tasks if task.scheduled_day and task.scheduled_day >= from_
            ]
        if to:
            start_tasks = [
                task for task in start_tasks if task.scheduled_day and task.scheduled_day <= to
            ]

    count = len(start_tasks)
    log_metric(
        "task.list.success",
        1,
        metadata={"user_id": str(user_id), "status": status},
    )
    log_metric(
        "task.list.count",
        count,
        metadata={"user_id": str(user_id), "status": status},
    )

    return [_serialize_task(task) for task in start_tasks]


@router.patch("/tasks/{task_id}", response_model=TaskUpdateResponse, tags=["tasks"])
def update_task_completion(
    task_id: UUID,
    payload: TaskUpdateRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> TaskUpdateResponse:
    """Mark a task complete or incomplete."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if task.user_id != payload.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Task does not belong to user")

    request_id = getattr(http_request.state, "request_id", None)
    metadata: Dict[str, Any] = {
        "route": f"/tasks/{task_id}",
        "task_id": str(task_id),
        "user_id": str(payload.user_id),
        "completed": payload.completed,
        "request_id": request_id,
    }

    changed = False
    start_time = datetime.now(timezone.utc)
    try:
        with trace(
            "task.complete",
            metadata=metadata,
            user_id=str(payload.user_id),
            request_id=request_id,
        ):
            if task.completed != payload.completed:
                changed = True
                task.completed = payload.completed
                task.completed_at = datetime.now(timezone.utc) if payload.completed else None

                log = AgentActionLog(
                    user_id=payload.user_id,
                    action_type="task_completed" if payload.completed else "task_uncompleted",
                    action_payload={
                        "task_id": str(task.id),
                        "completed": payload.completed,
                        "resolution_id": str(task.resolution_id) if task.resolution_id else None,
                        "request_id": request_id,
                    },
                    reason="Task completion toggled",
                    undo_available=True,
                )
                db.add(log)

            db.add(task)
            db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    latency_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
    log_metric(
        "task.complete.success",
        1,
        metadata={"user_id": str(payload.user_id), "task_id": str(task_id)},
    )
    log_metric(
        "task.complete.changed",
        1 if changed else 0,
        metadata={"user_id": str(payload.user_id), "task_id": str(task_id)},
    )
    log_metric(
        "task.complete.latency_ms",
        latency_ms,
        metadata={"task_id": str(task_id)},
    )

    return TaskUpdateResponse(
        id=task.id,
        completed=bool(task.completed),
        completed_at=task.completed_at,
        request_id=request_id or "",
    )


def _is_draft_task(task: Task) -> bool:
    metadata = task.metadata_json or {}
    return bool(metadata.get("draft")) and metadata.get("source") == "decomposer_v1"


def _serialize_task(task: Task) -> TaskSummary:
    metadata = task.metadata_json or {}
    source = metadata.get("source") or "unknown"
    if source not in {"decomposer_v1", "manual", "unknown"}:
        source = "unknown"

    note_value = metadata.get("note")
    if isinstance(note_value, str):
        note_text = note_value
    else:
        note_text = None

    return TaskSummary(
        id=task.id,
        resolution_id=task.resolution_id,
        title=task.title,
        scheduled_day=task.scheduled_day,
        scheduled_time=task.scheduled_time,
        duration_min=task.duration_min,
        completed=bool(task.completed),
        note=note_text,
        created_at=task.created_at,
        updated_at=task.updated_at,
        source=source,
    )


@router.patch("/tasks/{task_id}/note", response_model=TaskNoteUpdateResponse, tags=["tasks"])
def update_task_note(
    task_id: UUID,
    payload: TaskNoteUpdateRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> TaskNoteUpdateResponse:
    """Set or clear a task note."""
    task = db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if task.user_id != payload.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Task does not belong to user")

    request_id = getattr(http_request.state, "request_id", None)
    metadata = dict(task.metadata_json or {})
    current_note = metadata.get("note") if isinstance(metadata.get("note"), str) else None

    new_note = payload.note
    if new_note is not None:
        trimmed = new_note.strip()
        if len(trimmed) > 500:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Note must be 500 characters or less")
        new_note = trimmed or None

    changed = current_note != new_note
    note_length = len(new_note) if new_note else 0

    start_time = datetime.now(timezone.utc)
    try:
        with trace(
            "task.note",
            metadata={
                "route": f"/tasks/{task_id}/note",
                "task_id": str(task_id),
                "user_id": str(payload.user_id),
                "note_length": note_length,
                "changed": changed,
                "request_id": request_id,
            },
            user_id=str(payload.user_id),
            request_id=request_id,
        ):
            if changed:
                if new_note is None:
                    metadata.pop("note", None)
                else:
                    metadata["note"] = new_note
                task.metadata_json = metadata
                log = AgentActionLog(
                    user_id=payload.user_id,
                    action_type="task_note_updated" if new_note else "task_note_cleared",
                    action_payload={
                        "task_id": str(task.id),
                        "resolution_id": str(task.resolution_id) if task.resolution_id else None,
                        "previous_note_present": bool(current_note),
                        "note_length": note_length,
                        "request_id": request_id,
                    },
                    reason="Task note updated",
                    undo_available=True,
                )
                db.add(log)
            db.add(task)
            db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    latency_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
    log_metric(
        "task.note.success",
        1,
        metadata={"user_id": str(payload.user_id), "task_id": str(task_id)},
    )
    log_metric(
        "task.note.changed",
        1 if changed else 0,
        metadata={"user_id": str(payload.user_id), "task_id": str(task_id)},
    )
    log_metric(
        "task.note.length",
        note_length,
        metadata={"task_id": str(task_id)},
    )
    log_metric("task.note.latency_ms", latency_ms, metadata={"task_id": str(task_id)})

    return TaskNoteUpdateResponse(
        id=task.id,
        note=new_note,
        request_id=request_id or "",
    )
