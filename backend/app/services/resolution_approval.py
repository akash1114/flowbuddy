"""Service helpers for resolution approval."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Tuple
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.schemas.approval import ApprovalRequest, ApprovedTaskPayload
from app.api.routes import resolution as resolution_routes
from app.db.models.agent_action_log import AgentActionLog
from app.db.models.resolution import Resolution
from app.services import resolution_tasks


def approve_resolution(
    db: Session,
    resolution_id: UUID,
    payload: ApprovalRequest,
    request_id: str | None,
) -> Tuple[Resolution, List[ApprovedTaskPayload], str | None, int, int]:
    """Approve, reject, or request regeneration for a resolution plan."""
    resolution = db.get(Resolution, resolution_id)
    if not resolution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resolution not found")

    if resolution.user_id != payload.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Resolution does not belong to user")

    metadata = dict(resolution.metadata_json or {})
    decision = payload.decision
    response_tasks: List[ApprovedTaskPayload] = []
    message: str | None = None
    tasks_approved = 0
    edits_count = 0

    try:
        if decision == "accept":
            (
                response_tasks,
                message,
                tasks_approved,
                edits_count,
            ) = _handle_accept(db, resolution, metadata, payload, request_id)
        elif decision == "reject":
            message = _handle_reject(db, resolution, metadata, request_id)
        else:
            message = _handle_regenerate(db, resolution, metadata, request_id)

        db.add(resolution)
        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to persist approval decision",
        ) from exc
    except Exception:
        db.rollback()
        raise

    return resolution, response_tasks, message, tasks_approved, edits_count


def _handle_accept(
    db: Session,
    resolution: Resolution,
    metadata: dict,
    payload: ApprovalRequest,
    request_id: str | None,
) -> Tuple[List[ApprovedTaskPayload], str, int, int]:
    if resolution.status == "active":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Resolution already active")
    if "plan_v1" not in metadata:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Decompose resolution before approval")

    draft_tasks = resolution_tasks.fetch_draft_tasks(db, resolution.id)
    if not draft_tasks:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No draft tasks available; run decomposition first",
        )

    tasks_map = {task.id: task for task in draft_tasks if task.user_id == resolution.user_id}
    task_edits = payload.task_edits
    invalid_edits = [
        str(edit.task_id)
        for edit in task_edits
        if edit.task_id not in tasks_map
    ]
    if invalid_edits:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"task_edits references invalid task_id(s): {', '.join(invalid_edits)}",
        )

    edits_count = resolution_tasks.apply_task_edits(tasks_map, task_edits)
    activated_at = datetime.now(timezone.utc).isoformat()
    resolution_routes._activate_tasks(draft_tasks, activated_at)
    metadata["approved_at"] = activated_at
    resolution.metadata_json = metadata
    resolution.status = "active"
    response_tasks = [resolution_tasks.serialize_active_task(task) for task in draft_tasks]
    message = "Resolution activated."
    action_payload = {
        "resolution_id": str(resolution.id),
        "decision": payload.decision,
        "tasks_approved": [str(task.id) for task in draft_tasks],
        "edits_count": edits_count,
        "plan_version": "plan_v1" if "plan_v1" in metadata else None,
        "request_id": request_id,
    }
    _log_agent_action(
        db=db,
        resolution=resolution,
        action_type="resolution_approved",
        reason=f"User accepted plan for resolution {resolution.id}",
        payload=action_payload,
        undo_available=True,
    )
    return response_tasks, message, len(draft_tasks), edits_count


def _handle_reject(
    db: Session,
    resolution: Resolution,
    metadata: dict,
    request_id: str | None,
) -> str:
    rejected_at = datetime.now(timezone.utc).isoformat()
    metadata["rejected_at"] = rejected_at
    resolution.metadata_json = metadata
    message = "Resolution kept in draft."
    action_payload = {
        "resolution_id": str(resolution.id),
        "decision": "reject",
        "request_id": request_id,
    }
    _log_agent_action(
        db=db,
        resolution=resolution,
        action_type="resolution_rejected",
        reason=f"User rejected plan for resolution {resolution.id}",
        payload=action_payload,
        undo_available=False,
    )
    return message


def _handle_regenerate(
    db: Session,
    resolution: Resolution,
    metadata: dict,
    request_id: str | None,
) -> str:
    requested_at = datetime.now(timezone.utc).isoformat()
    metadata["regeneration_requested_at"] = requested_at
    resolution.metadata_json = metadata
    message = "Regeneration requested. Run /decompose with regenerate=true to refresh the plan."
    action_payload = {
        "resolution_id": str(resolution.id),
        "decision": "regenerate",
        "request_id": request_id,
    }
    _log_agent_action(
        db=db,
        resolution=resolution,
        action_type="resolution_regenerate_requested",
        reason=f"User requested regeneration for resolution {resolution.id}",
        payload=action_payload,
        undo_available=False,
    )
    return message


def _log_agent_action(
    db: Session,
    resolution: Resolution,
    action_type: str,
    reason: str,
    payload: dict,
    undo_available: bool,
) -> None:
    log = AgentActionLog(
        user_id=resolution.user_id,
        action_type=action_type,
        action_payload=payload,
        reason=reason,
        undo_available=undo_available,
    )
    db.add(log)
