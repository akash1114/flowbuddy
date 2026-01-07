"""Agent action log transparency endpoints."""
from __future__ import annotations

import base64
from datetime import datetime
from time import perf_counter
from typing import Any, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, desc, or_
from sqlalchemy.orm import Session

from app.api.schemas.agent_log import AgentLogDetailResponse, AgentLogListItem, AgentLogListResponse
from app.db.deps import get_db
from app.db.models.agent_action_log import AgentActionLog
from app.observability.metrics import log_metric
from app.observability.tracing import trace

router = APIRouter()


@router.get("/agent-log", response_model=AgentLogListResponse, tags=["agent-log"])
def list_agent_log(
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    limit: int = Query(50, ge=1, le=100),
    cursor: str | None = Query(None),
    action_type: str | None = Query(None, description="Filter by action type"),
    db: Session = Depends(get_db),
) -> AgentLogListResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {
        "user_id": str(user_id),
        "limit": limit,
        "cursor": bool(cursor),
        "action_type": action_type,
        "request_id": request_id,
    }
    start = perf_counter()
    with trace("agent_log.list", metadata=metadata, user_id=str(user_id), request_id=request_id):
        query = db.query(AgentActionLog).filter(AgentActionLog.user_id == user_id)
        if action_type:
            query = query.filter(AgentActionLog.action_type == action_type)
        if cursor:
            try:
                cursor_created, cursor_id = _decode_cursor(cursor)
            except ValueError:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid cursor")
            query = query.filter(
                or_(
                    AgentActionLog.created_at < cursor_created,
                    and_(AgentActionLog.created_at == cursor_created, AgentActionLog.id < cursor_id),
                )
            )
        logs = (
            query.order_by(desc(AgentActionLog.created_at), desc(AgentActionLog.id))
            .limit(limit + 1)
            .all()
        )

    latency_ms = (perf_counter() - start) * 1000
    has_more = len(logs) > limit
    items = [_serialize_log_item(log) for log in logs[:limit]]
    next_cursor = _encode_cursor(logs[limit]) if has_more else None

    log_metric("agent_log.list.success", 1, metadata={"user_id": str(user_id)})
    log_metric("agent_log.list.count", len(items), metadata={"user_id": str(user_id)})
    log_metric("agent_log.list.latency_ms", latency_ms, metadata={"user_id": str(user_id)})

    return AgentLogListResponse(
        user_id=user_id,
        items=items,
        next_cursor=next_cursor,
        request_id=request_id or "",
    )


@router.get("/agent-log/{log_id}", response_model=AgentLogDetailResponse, tags=["agent-log"])
def get_agent_log(
    log_id: UUID,
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    db: Session = Depends(get_db),
) -> AgentLogDetailResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "log_id": str(log_id), "request_id": request_id}
    start = perf_counter()
    with trace("agent_log.get", metadata=metadata, user_id=str(user_id), request_id=request_id):
        log_entry = db.get(AgentActionLog, log_id)
        if not log_entry:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent log entry not found")
        if log_entry.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Log does not belong to user")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("agent_log.get.success", 1, metadata={"user_id": str(user_id)})
    log_metric("agent_log.get.latency_ms", latency_ms, metadata={"user_id": str(user_id)})

    payload = _ensure_payload_dict(log_entry.action_payload)
    return AgentLogDetailResponse(
        id=log_entry.id,
        user_id=log_entry.user_id,
        created_at=log_entry.created_at.isoformat() if log_entry.created_at else "",
        action_type=log_entry.action_type,
        undo_available=bool(log_entry.undo_available),
        payload=payload,
        summary=_derive_summary(log_entry.action_type, payload),
        request_id=_extract_request_id(payload),
        request_id_header=request_id or "",
    )


def _serialize_log_item(log: AgentActionLog) -> AgentLogListItem:
    payload = _ensure_payload_dict(log.action_payload)
    return AgentLogListItem(
        id=log.id,
        created_at=log.created_at.isoformat() if log.created_at else "",
        action_type=log.action_type,
        undo_available=bool(log.undo_available),
        summary=_derive_summary(log.action_type, payload),
        request_id=_extract_request_id(payload),
    )


def _derive_summary(action_type: str, payload: dict[str, Any]) -> str:
    action_map = {
        "weekly_plan_generated": "Weekly plan generated",
        "preferences_updated": "Preferences updated",
        "task_completed": "Task marked complete",
        "task_uncompleted": "Task marked incomplete",
        "task_note_updated": "Task note updated",
        "task_note_cleared": "Task note cleared",
        "resolution_approved": "Plan approved",
        "resolution_rejected": "Plan rejected",
        "resolution_regenerate_requested": "Plan regenerated",
        "brain_dump_ingested": "Brain dump captured",
    }
    if action_type in action_map:
        return action_map[action_type]

    if action_type == "intervention_generated":
        slippage = payload.get("slippage") or {}
        flagged = bool(slippage.get("flagged"))
        status = "flagged" if flagged else "on track"
        return f"Check-in generated ({status})"

    if action_type.startswith("notification_"):
        result = (payload.get("result") or {}).get("status") if isinstance(payload.get("result"), dict) else None
        status_label = result or "noop"
        return f"Notification attempted ({status_label})"

    return action_type.replace("_", " ").title()


def _extract_request_id(payload: dict[str, Any]) -> str | None:
    value = payload.get("request_id")
    if isinstance(value, str) and value:
        return value
    return None


def _encode_cursor(log: AgentActionLog) -> str | None:
    if not log.created_at:
        return None
    raw = f"{log.created_at.isoformat()}|{log.id}"
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")
    return encoded


def _decode_cursor(cursor: str) -> Tuple[datetime, UUID]:
    try:
        decoded = base64.urlsafe_b64decode(cursor.encode("utf-8")).decode("utf-8")
        created_str, log_id_str = decoded.split("|", 1)
        created_at = datetime.fromisoformat(created_str)
        log_id = UUID(log_id_str)
        return created_at, log_id
    except Exception as exc:  # pragma: no cover - defensive
        raise ValueError("invalid cursor") from exc


def _ensure_payload_dict(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    return {}
