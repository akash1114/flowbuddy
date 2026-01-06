"""Resolution read endpoints."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.schemas.approval import ApprovedTaskPayload
from app.api.schemas.decomposition import DraftTaskPayload
from app.api.schemas.resolution import (
    ResolutionDetailResponse,
    ResolutionSummary,
)
from app.db.deps import get_db
from app.db.models.resolution import Resolution
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.resolution_tasks import (
    activate_tasks as _activate_tasks,
    fetch_active_tasks,
    fetch_draft_tasks,
    serialize_active_task,
    serialize_draft_task,
)

router = APIRouter()


@router.get("/resolutions", response_model=List[ResolutionSummary], tags=["resolutions"])
def list_resolutions(
    http_request: Request,
    user_id: UUID = Query(..., description="User ID owning the resolutions"),
    status: Optional[str] = Query(default=None, pattern="^(draft|active)$"),
    db: Session = Depends(get_db),
) -> List[ResolutionSummary]:
    """List resolutions for a user with optional status filtering."""
    request_id = getattr(http_request.state, "request_id", None) if http_request else None
    metadata: Dict[str, Any] = {
        "route": "/resolutions",
        "user_id": str(user_id),
        "status": status,
        "request_id": request_id,
    }

    with trace(
        "resolution.list",
        metadata=metadata,
        user_id=str(user_id),
        request_id=request_id,
    ):
        query = db.query(Resolution).filter(Resolution.user_id == user_id)
        if status:
            query = query.filter(Resolution.status == status)
        resolutions = query.order_by(Resolution.updated_at.desc()).all()

    log_metric(
        "resolution.list.count",
        len(resolutions),
        metadata={"user_id": str(user_id), "status": status or "all"},
    )

    return [
        ResolutionSummary(
            id=res.id,
            title=res.title,
            type=res.type,
            status=res.status,
            duration_weeks=res.duration_weeks,
            updated_at=res.updated_at,
        )
        for res in resolutions
    ]


@router.get(
    "/resolutions/{resolution_id}",
    response_model=ResolutionDetailResponse,
    tags=["resolutions"],
)
def get_resolution_detail(
    resolution_id: UUID,
    http_request: Request,
    user_id: UUID = Query(..., description="User ID that must own the resolution"),
    db: Session = Depends(get_db),
) -> ResolutionDetailResponse:
    """Return a resolution plus its plan and relevant tasks."""
    request_id = getattr(http_request.state, "request_id", None) if http_request else None
    resolution = db.get(Resolution, resolution_id)
    if not resolution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resolution not found")
    if resolution.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Resolution does not belong to user")

    metadata_dict = dict(resolution.metadata_json or {})
    plan_payload = metadata_dict.get("plan_v1")
    plan_data = plan_payload if isinstance(plan_payload, dict) else None

    draft_tasks: List[DraftTaskPayload] = []
    active_tasks: List[ApprovedTaskPayload] = []

    with trace(
        "resolution.get",
        metadata={
            "route": f"/resolutions/{resolution_id}",
            "resolution_id": str(resolution_id),
            "user_id": str(user_id),
            "status": resolution.status,
            "request_id": request_id,
        },
        user_id=str(user_id),
        request_id=request_id,
    ):
        if resolution.status == "draft":
            draft_tasks = [serialize_draft_task(task) for task in fetch_draft_tasks(db, resolution.id)]
        else:
            active_tasks = [serialize_active_task(task) for task in fetch_active_tasks(db, resolution.id)]

    log_metric(
        "resolution.get.success",
        1,
        metadata={"user_id": str(user_id), "resolution_id": str(resolution_id), "status": resolution.status},
    )

    return ResolutionDetailResponse(
        id=resolution.id,
        user_id=resolution.user_id,
        title=resolution.title,
        type=resolution.type,
        status=resolution.status,
        duration_weeks=resolution.duration_weeks,
        plan=plan_data,
        draft_tasks=draft_tasks,
        active_tasks=active_tasks,
        request_id=request_id or "",
    )
