"""Weekly plan preview endpoints."""
from __future__ import annotations

from uuid import UUID

from time import perf_counter
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api.schemas.weekly_plan import (
    WeeklyPlanPreviewResponse,
    WeeklyPlanRunRequest,
    WeeklyPlanHistoryResponse,
    WeeklyPlanHistoryItem,
    WeeklyPlanHistoryDetailResponse,
    WeeklyPlanResponse,
)
from app.db.deps import get_db
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.weekly_planner import (
    get_weekly_plan_preview,
    load_latest_weekly_plan,
    persist_weekly_plan_preview,
)
from app.services.notifications.hooks import notify_weekly_plan_snapshot
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
                force=payload.force,
            )
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("weekly_plan.run.success", 1, metadata={"user_id": str(payload.user_id)})
    log_metric(
        "weekly_plan.run.snapshot_created",
        1 if result.created else 0,
        metadata={"user_id": str(payload.user_id), "force": payload.force},
    )
    log_metric("weekly_plan.run.latency_ms", latency_ms, metadata={"user_id": str(payload.user_id)})
    response = _response_from_log(result.log)
    if result.created:
        notify_weekly_plan_snapshot(db, result.log, request_id)
    return response


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


@router.get("/weekly-plan/history", response_model=WeeklyPlanHistoryResponse, tags=["weekly-plan"])
def weekly_plan_history(
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> WeeklyPlanHistoryResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "request_id": request_id, "limit": limit}
    start = perf_counter()
    with trace("weekly_plan.history", metadata=metadata, user_id=str(user_id), request_id=request_id):
        logs = (
            db.query(AgentActionLog)
            .filter(
                AgentActionLog.user_id == user_id,
                AgentActionLog.action_type == "weekly_plan_generated",
            )
            .order_by(desc(AgentActionLog.created_at), desc(AgentActionLog.id))
            .limit(limit)
            .all()
        )

    latency_ms = (perf_counter() - start) * 1000
    log_metric("weekly_plan.history.success", 1, metadata={"user_id": str(user_id)})
    log_metric("weekly_plan.history.count", len(logs), metadata={"user_id": str(user_id)})
    log_metric("weekly_plan.history.latency_ms", latency_ms, metadata={"user_id": str(user_id)})

    items = [_history_summary_from_log(log) for log in logs]
    return WeeklyPlanHistoryResponse(
        user_id=user_id,
        items=items,
        next_cursor=None,
        request_id=request_id or "",
    )


@router.get(
    "/weekly-plan/history/{log_id}",
    response_model=WeeklyPlanHistoryDetailResponse,
    tags=["weekly-plan"],
)
def weekly_plan_history_item(
    log_id: UUID,
    request: Request,
    user_id: UUID = Query(..., description="User ID"),
    db: Session = Depends(get_db),
) -> WeeklyPlanHistoryDetailResponse:
    request_id = getattr(request.state, "request_id", None)
    metadata = {"user_id": str(user_id), "log_id": str(log_id), "request_id": request_id}
    start = perf_counter()
    with trace("weekly_plan.history_item", metadata=metadata, user_id=str(user_id), request_id=request_id):
        log = db.get(AgentActionLog, log_id)
        if not log:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Snapshot not found")
        if log.user_id != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Snapshot does not belong to user")

    latency_ms = (perf_counter() - start) * 1000
    log_metric("weekly_plan.history_item.success", 1, metadata={"user_id": str(user_id)})
    log_metric("weekly_plan.history_item.latency_ms", latency_ms, metadata={"user_id": str(user_id)})

    payload = log.action_payload or {}
    snapshot = _response_from_log(log)
    return WeeklyPlanHistoryDetailResponse(
        id=log.id,
        user_id=log.user_id,
        created_at=log.created_at.isoformat() if log.created_at else "",
        week_start=payload.get("week_start") or snapshot.week["start"],
        week_end=payload.get("week_end") or snapshot.week["end"],
        snapshot=snapshot,
        request_id=request_id or "",
    )


def _response_from_log(log: AgentActionLog) -> WeeklyPlanResponse:
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
    return WeeklyPlanResponse(
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


def _history_summary_from_log(log: AgentActionLog) -> WeeklyPlanHistoryItem:
    payload = log.action_payload or {}
    inputs = payload.get("inputs") or {}
    micro = payload.get("micro_resolution") or {}
    week_start = payload.get("week_start") or payload.get("week", {}).get("start", "")
    week_end = payload.get("week_end") or payload.get("week", {}).get("end", "")
    return WeeklyPlanHistoryItem(
        id=log.id,
        created_at=log.created_at.isoformat() if log.created_at else "",
        week_start=week_start,
        week_end=week_end,
        title=micro.get("title", ""),
        completion_rate=inputs.get("completion_rate"),
    )
