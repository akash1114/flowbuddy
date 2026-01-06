"""Notification configuration routes."""
from __future__ import annotations

from fastapi import APIRouter, Request

from app.core.config import settings
from app.observability.metrics import log_metric
from app.observability.tracing import trace


router = APIRouter()


@router.get("/notifications/config", tags=["notifications"])
def get_notifications_config(request: Request) -> dict:
    request_id = getattr(request.state, "request_id", None)
    with trace(
        "notifications.config",
        metadata={"provider": settings.notifications_provider},
        request_id=request_id,
    ):
        log_metric("notifications.config.success", 1, metadata={"provider": settings.notifications_provider})
        return {
            "enabled": settings.notifications_enabled,
            "provider": settings.notifications_provider,
            "request_id": request_id or "",
        }
