"""Intervention preview endpoint."""
from __future__ import annotations

from uuid import UUID

from time import perf_counter
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.schemas.interventions import (
    InterventionPreviewResponse,
    InterventionRunRequest,
    InterventionCard,
    SlippagePayload,
    InterventionHistoryResponse,
    InterventionHistoryItem,
    InterventionHistoryDetailResponse,
    InterventionResponse,
)
from app.db.deps import get_db
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.intervention_service import (
    get_intervention_preview,
    load_latest_intervention,
    persist_intervention_preview,
)
from app.services.notifications.hooks import notify_intervention_snapshot
from app.db.models.agent_action_log import AgentActionLog

router = APIRouter()


@router.get("/interventions/preview", response_model=InterventionPreviewResponse, tags=["interventions"])
def interventions_preview(
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    db: Session = Depends(get_db),
) -> InterventionPreviewResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "request_id": request_id}
    start = perf_counter()
    with trace("interventions.preview", metadata=metadata, user_id=str(user_id), request_id=request_id):
        preview = get_intervention_preview(db, user_id)

    log_metric(
        "interventions.preview.success",
        1,
        metadata={"user_id": str(user_id)},
    )
    log_metric(
        "interventions.preview.flagged",
        1 if preview.slippage.flagged else 0,
        metadata={"user_id": str(user_id)},
    )
    log_metric(
        "interventions.preview.completion_rate",
        preview.slippage.completion_rate,
        metadata={"user_id": str(user_id)},
    )
    latency_ms = (perf_counter() - start) * 1000
    log_metric(
        "interventions.preview.latency_ms",
        latency_ms,
        metadata={"user_id": str(user_id)},
    )

    return InterventionPreviewResponse(
        user_id=user_id,
        week={"start": preview.week[0], "end": preview.week[1]},
        slippage=preview.slippage,
        card=preview.card,
        request_id=request_id or "",
    )


@router.post("/interventions/run", response_model=InterventionPreviewResponse, tags=["interventions"])
def interventions_run(
    request: Request,
    payload: InterventionRunRequest,
    db: Session = Depends(get_db),
) -> InterventionPreviewResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(payload.user_id), "request_id": request_id}
    start = perf_counter()
    with trace("interventions.run", metadata=metadata, user_id=str(payload.user_id), request_id=request_id):
        preview = get_intervention_preview(db, payload.user_id)
        try:
            result = persist_intervention_preview(
                db,
                user_id=payload.user_id,
                preview=preview,
                request_id=request_id,
                force=payload.force,
            )
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("interventions.run.success", 1, metadata={"user_id": str(payload.user_id)})
    log_metric(
        "interventions.run.snapshot_created",
        1 if result.created else 0,
        metadata={"user_id": str(payload.user_id), "force": payload.force},
    )
    log_metric("interventions.run.latency_ms", latency_ms, metadata={"user_id": str(payload.user_id)})
    response = _intervention_response_from_log(result.log)
    if result.created:
        notify_intervention_snapshot(db, result.log, request_id)
    return response


@router.get("/interventions/latest", response_model=InterventionPreviewResponse, tags=["interventions"])
def interventions_latest(
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    db: Session = Depends(get_db),
) -> InterventionPreviewResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "request_id": request_id}
    start = perf_counter()
    with trace("interventions.latest", metadata=metadata, user_id=str(user_id), request_id=request_id):
        log = load_latest_intervention(db, user_id)
        if not log:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No intervention snapshot found")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("interventions.latest.success", 1, metadata={"user_id": str(user_id)})
    log_metric("interventions.latest.latency_ms", latency_ms, metadata={"user_id": str(user_id)})
    return _intervention_response_from_log(log)


@router.get("/interventions/history", response_model=InterventionHistoryResponse, tags=["interventions"])
def interventions_history(
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> InterventionHistoryResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "request_id": request_id, "limit": limit}
    start = perf_counter()
    with trace("interventions.history", metadata=metadata, user_id=str(user_id), request_id=request_id):
        logs = (
            db.query(AgentActionLog)
            .filter(
                AgentActionLog.user_id == user_id,
                AgentActionLog.action_type == "intervention_generated",
            )
            .order_by(desc(AgentActionLog.created_at), desc(AgentActionLog.id))
            .limit(limit)
            .all()
        )

    latency_ms = (perf_counter() - start) * 1000
    log_metric("interventions.history.success", 1, metadata={"user_id": str(user_id)})
    log_metric("interventions.history.count", len(logs), metadata={"user_id": str(user_id)})
    log_metric("interventions.history.latency_ms", latency_ms, metadata={"user_id": str(user_id)})

    items = [_intervention_history_item(log) for log in logs]
    return InterventionHistoryResponse(
        user_id=user_id,
        items=items,
        next_cursor=None,
        request_id=request_id or "",
    )


@router.get(
    "/interventions/history/{log_id}",
    response_model=InterventionHistoryDetailResponse,
    tags=["interventions"],
)
def interventions_history_item(
    log_id: UUID,
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    db: Session = Depends(get_db),
) -> InterventionHistoryDetailResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "log_id": str(log_id), "request_id": request_id}
    start = perf_counter()
    with trace("interventions.history_item", metadata=metadata, user_id=str(user_id), request_id=request_id):
        log = db.get(AgentActionLog, log_id)
        if not log:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
        if log.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Snapshot does not belong to user")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("interventions.history_item.success", 1, metadata={"user_id": str(user_id)})
    log_metric("interventions.history_item.latency_ms", latency_ms, metadata={"user_id": str(user_id)})

    payload = log.action_payload or {}
    snapshot = _intervention_response_from_log(log)
    return InterventionHistoryDetailResponse(
        id=log.id,
        user_id=log.user_id,
        created_at=log.created_at.isoformat() if log.created_at else "",
        week_start=payload.get("week_start") or snapshot.week["start"],
        week_end=payload.get("week_end") or snapshot.week["end"],
        snapshot=snapshot,
        request_id=request_id or "",
    )


def _intervention_response_from_log(log: AgentActionLog) -> InterventionResponse:
    payload = log.action_payload or {}
    week_payload = payload.get("week") or {
        "start": payload.get("week_start"),
        "end": payload.get("week_end"),
    }
    card_payload = payload.get("card")
    slippage_payload = payload.get("slippage") or {
        "flagged": False,
        "reason": None,
        "completion_rate": 0.0,
        "missed_scheduled": 0,
    }
    return InterventionResponse(
        user_id=payload.get("user_id", log.user_id),
        week=week_payload,
        slippage=SlippagePayload(**slippage_payload),
        card=InterventionCard(**card_payload) if card_payload else None,
        request_id=payload.get("request_id", ""),
    )


def _intervention_history_item(log: AgentActionLog) -> InterventionHistoryItem:
    payload = log.action_payload or {}
    slippage = payload.get("slippage") or {}
    week_start = payload.get("week_start") or payload.get("week", {}).get("start", "")
    week_end = payload.get("week_end") or payload.get("week", {}).get("end", "")
    return InterventionHistoryItem(
        id=log.id,
        created_at=log.created_at.isoformat() if log.created_at else "",
        week_start=week_start,
        week_end=week_end,
        flagged=bool(slippage.get("flagged", False)),
        reason=slippage.get("reason"),
    )
