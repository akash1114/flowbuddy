"""Intervention preview endpoint."""
from __future__ import annotations

from uuid import UUID

from time import perf_counter
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.schemas.interventions import (
    InterventionPreviewResponse,
    InterventionRunRequest,
    InterventionCard,
    SlippagePayload,
)
from app.db.deps import get_db
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.intervention_service import (
    get_intervention_preview,
    load_latest_intervention,
    persist_intervention_preview,
)
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
            )
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("interventions.run.success", 1, metadata={"user_id": str(payload.user_id)})
    log_metric(
        "interventions.run.snapshot_created",
        1 if result.created else 0,
        metadata={"user_id": str(payload.user_id)},
    )
    log_metric("interventions.run.latency_ms", latency_ms, metadata={"user_id": str(payload.user_id)})
    return _intervention_response_from_log(result.log)


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


def _intervention_response_from_log(log: AgentActionLog) -> InterventionPreviewResponse:
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
    return InterventionPreviewResponse(
        user_id=payload.get("user_id", log.user_id),
        week=week_payload,
        slippage=SlippagePayload(**slippage_payload),
        card=InterventionCard(**card_payload) if card_payload else None,
        request_id=payload.get("request_id", ""),
    )
