"""Weekly plan preview endpoints."""
from __future__ import annotations

from uuid import UUID

from time import perf_counter
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.schemas.weekly_plan import WeeklyPlanPreviewResponse, WeeklyPlanRunRequest
from app.db.deps import get_db
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.weekly_planner import (
    get_weekly_plan_preview,
    load_latest_weekly_plan,
    persist_weekly_plan_preview,
)
from app.api.schemas.weekly_plan import MicroResolutionPayload, WeeklyPlanInputs
from app.db.models.agent_action_log import AgentActionLog

router = APIRouter()


@router.get("/weekly-plan/preview", response_model=WeeklyPlanPreviewResponse, tags=["weekly-plan"])
def weekly_plan_preview(
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    db: Session = Depends(get_db),
) -> WeeklyPlanPreviewResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "request_id": request_id}
    success = False
    result = None
    start = perf_counter()

    with trace("weekly_plan.preview", metadata=metadata, user_id=user_id, request_id=request_id):
        preview = get_weekly_plan_preview(db, user_id)
        success = True
        result = preview

    log_metric(
        "weekly_plan.preview.success",
        1 if success else 0,
        metadata={"user_id": str(user_id)},
    )
    log_metric(
        "weekly_plan.preview.completion_rate",
        result.inputs.completion_rate if result else 0.0,
        metadata={"user_id": str(user_id)},
    )
    latency_ms = (perf_counter() - start) * 1000
    log_metric(
        "weekly_plan.preview.latency_ms",
        latency_ms,
        metadata={"user_id": str(user_id)},
    )

    return WeeklyPlanPreviewResponse(
        user_id=user_id,
        week={"start": result.week[0], "end": result.week[1]},
        inputs=result.inputs,
        micro_resolution=result.micro_resolution,
        request_id=request_id or "",
    )


@router.post("/weekly-plan/run", response_model=WeeklyPlanPreviewResponse, tags=["weekly-plan"])
def weekly_plan_run(
    request: Request,
    payload: WeeklyPlanRunRequest,
    db: Session = Depends(get_db),
) -> WeeklyPlanPreviewResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(payload.user_id), "request_id": request_id}
    start = perf_counter()
    with trace("weekly_plan.run", metadata=metadata, user_id=str(payload.user_id), request_id=request_id):
        preview = get_weekly_plan_preview(db, payload.user_id)
        try:
            result = persist_weekly_plan_preview(
                db,
                user_id=payload.user_id,
                preview=preview,
                request_id=request_id,
            )
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("weekly_plan.run.success", 1, metadata={"user_id": str(payload.user_id)})
    log_metric(
        "weekly_plan.run.snapshot_created",
        1 if result.created else 0,
        metadata={"user_id": str(payload.user_id)},
    )
    log_metric("weekly_plan.run.latency_ms", latency_ms, metadata={"user_id": str(payload.user_id)})
    return _response_from_log(result.log)


@router.get("/weekly-plan/latest", response_model=WeeklyPlanPreviewResponse, tags=["weekly-plan"])
def weekly_plan_latest(
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    db: Session = Depends(get_db),
) -> WeeklyPlanPreviewResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "request_id": request_id}
    start = perf_counter()
    with trace("weekly_plan.latest", metadata=metadata, user_id=str(user_id), request_id=request_id):
        log = load_latest_weekly_plan(db, user_id)
        if not log:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No weekly plan snapshot found")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("weekly_plan.latest.success", 1, metadata={"user_id": str(user_id)})
    log_metric("weekly_plan.latest.latency_ms", latency_ms, metadata={"user_id": str(user_id)})
    return _response_from_log(log)


def _response_from_log(log: AgentActionLog) -> WeeklyPlanPreviewResponse:
    payload = log.action_payload or {}
    week_payload = payload.get("week") or {
        "start": payload.get("week_start"),
        "end": payload.get("week_end"),
    }
    inputs_payload = payload.get("inputs") or {}
    micro_payload = payload.get("micro_resolution") or {
        "title": "Awaiting plan",
        "why_this": "",
        "suggested_week_1_tasks": [],
    }
    return WeeklyPlanPreviewResponse(
        user_id=payload.get("user_id", log.user_id),
        week=week_payload,
        inputs=WeeklyPlanInputs(
            active_resolutions=inputs_payload.get("active_resolutions", 0),
            active_tasks_total=inputs_payload.get("active_tasks_total", 0),
            active_tasks_completed=inputs_payload.get("active_tasks_completed", 0),
            completion_rate=inputs_payload.get("completion_rate", 0.0),
        ),
        micro_resolution=MicroResolutionPayload(**micro_payload),
        request_id=payload.get("request_id", ""),
    )
