"""Dashboard API routes."""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.schemas.dashboard import DashboardResponse
from app.db.deps import get_db
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.dashboard_service import get_dashboard_data

router = APIRouter()


@router.get("/dashboard", response_model=DashboardResponse, tags=["dashboard"])
def get_dashboard(
    http_request: Request,
    user_id: UUID = Query(..., description="User ID"),
    db: Session = Depends(get_db),
) -> DashboardResponse:
    request_id = getattr(http_request.state, "request_id", None)
    start_time = datetime.now(timezone.utc)

    entries = []
    with trace(
        "dashboard.get",
        metadata={"user_id": str(user_id), "request_id": request_id},
        user_id=str(user_id),
        request_id=request_id,
    ):
        entries = get_dashboard_data(db, user_id)

    latency_ms = (datetime.now(timezone.utc) - start_time).total_seconds() * 1000
    log_metric("dashboard.get.success", 1, metadata={"user_id": str(user_id)})
    log_metric("dashboard.get.resolutions_count", len(entries), metadata={"user_id": str(user_id)})
    log_metric("dashboard.get.latency_ms", latency_ms, metadata={"user_id": str(user_id)})

    return DashboardResponse(
        user_id=user_id,
        active_resolutions=entries,
        request_id=request_id or "",
    )
