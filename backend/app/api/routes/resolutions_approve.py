"""Resolution approval endpoint."""
from __future__ import annotations

from time import perf_counter
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api.schemas.approval import ApprovalRequest, ApprovalResponse, ApprovedTaskPayload
from app.db.deps import get_db
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.resolution_approval import approve_resolution

router = APIRouter()


@router.post(
    "/resolutions/{resolution_id}/approve",
    response_model=ApprovalResponse,
    tags=["resolutions"],
)
def approve_resolution_endpoint(
    resolution_id: UUID,
    payload: ApprovalRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> ApprovalResponse:
    """Approve, reject, or request regeneration for a resolution plan."""
    request_id = getattr(http_request.state, "request_id", None)

    base_metadata: Dict[str, Any] = {
        "route": f"/resolutions/{resolution_id}/approve",
        "resolution_id": str(resolution_id),
        "user_id": str(payload.user_id),
        "decision": payload.decision,
        "request_id": request_id,
    }

    start_time = perf_counter()
    success = False
    tasks_approved = 0
    edits_count = 0
    response_tasks: List[ApprovedTaskPayload] = []
    message: str | None = None

    try:
        with trace(
            "resolution.approval",
            metadata=base_metadata,
            user_id=str(payload.user_id),
            request_id=request_id,
        ) as span:
            (
                resolution,
                response_tasks,
                message,
                tasks_approved,
                edits_count,
            ) = approve_resolution(
                db=db,
                resolution_id=resolution_id,
                payload=payload,
                request_id=request_id,
            )
            success = True
            if span:
                try:
                    span.update(
                        metadata={**base_metadata, "tasks_approved": tasks_approved, "edits_count": edits_count}
                    )
                except Exception:
                    pass
    finally:
        latency_ms = (perf_counter() - start_time) * 1000
        metric_metadata = {
            "resolution_id": str(resolution_id),
            "user_id": str(payload.user_id),
            "decision": payload.decision,
            "tasks_approved": tasks_approved,
            "edits_count": edits_count,
        }
        log_metric("resolution.approval.success", 1 if success else 0, metadata=metric_metadata)
        log_metric("resolution.approval.tasks_approved", tasks_approved, metadata=metric_metadata)
        log_metric("resolution.approval.latency_ms", latency_ms, metadata=metric_metadata)

    return ApprovalResponse(
        resolution_id=resolution.id,
        status=resolution.status,
        tasks_activated=response_tasks,
        message=message,
        request_id=request_id or "",
    )
