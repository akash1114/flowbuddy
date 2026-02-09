"""Notification hook utilities."""
from __future__ import annotations

import logging
from time import perf_counter
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models.agent_action_log import AgentActionLog
from app.services.notifications.base import NotificationResult
from app.services.notifications.factory import get_notification_service
from app.services.preferences_service import get_or_create_preferences
from app.observability.metrics import log_metric
from app.observability.tracing import trace


logger = logging.getLogger(__name__)


def notify_weekly_plan_snapshot(db: Session, log: AgentActionLog, request_id: str | None) -> None:
    payload = log.action_payload or {}
    week_start = payload.get("week_start")
    week_end = payload.get("week_end")
    _notify(
        db,
        job_name="weekly_plan",
        log=log,
        request_id=request_id,
        week_start=week_start,
        week_end=week_end,
        extra={
            "completion_rate": payload.get("inputs", {}).get("completion_rate"),
            "week_start": week_start,
            "week_end": week_end,
        },
    )


def notify_intervention_snapshot(db: Session, log: AgentActionLog, request_id: str | None) -> None:
    payload = log.action_payload or {}
    week_start = payload.get("week_start")
    week_end = payload.get("week_end")
    slippage = payload.get("slippage") or {}
    _notify(
        db,
        job_name="intervention",
        log=log,
        request_id=request_id,
        week_start=week_start,
        week_end=week_end,
        extra={
            "flagged": slippage.get("flagged", False),
            "reason": slippage.get("reason"),
            "week_start": week_start,
            "week_end": week_end,
        },
    )


def _notify(
    db: Session,
    *,
    job_name: str,
    log: AgentActionLog,
    request_id: str | None,
    week_start: str | None,
    week_end: str | None,
    extra: dict,
) -> None:
    if not settings.notifications_enabled:
        _record_notification_log(
            db,
            log,
            job_name,
            result=NotificationResult(status="skipped", reason="notifications disabled"),
            request_id=request_id,
            extra=extra,
        )
        return

    prefs = get_or_create_preferences(db, log.user_id)
    if job_name == "weekly_plan" and (prefs.coaching_paused or not prefs.weekly_plans_enabled):
        _record_notification_log(
            db,
            log,
            job_name,
            result=NotificationResult(status="skipped", reason="preferences disabled"),
            request_id=request_id,
            extra=extra,
        )
        return
    if job_name == "intervention" and (prefs.coaching_paused or not prefs.interventions_enabled):
        _record_notification_log(
            db,
            log,
            job_name,
            result=NotificationResult(status="skipped", reason="preferences disabled"),
            request_id=request_id,
            extra=extra,
        )
        return
    flagged_value = extra.get("flagged")
    if job_name == "intervention" and not _is_truthy(flagged_value):
        _record_notification_log(
            db,
            log,
            job_name,
            result=NotificationResult(status="skipped", reason="slippage not flagged"),
            request_id=request_id,
            extra=extra,
        )
        return

    service = get_notification_service()
    trace_name = f"notifications.{job_name}"
    payload = log.action_payload or {}
    if job_name == "weekly_plan":
        plan = payload.get("micro_resolution") or {}
        week_tasks = plan.get("suggested_week_1_tasks") or plan.get("week_1_tasks") or []
        titles = [task.get("title") for task in week_tasks if isinstance(task, dict) and task.get("title")]
        plan_summary = plan.get("title") or plan.get("resolution_title") or "Next week blueprint"
        if titles:
            plan_summary = f"{plan_summary} | Week 1: {', '.join(titles[:4])}"
        input_summary = plan_summary
    else:
        card = payload.get("card") or {}
        input_summary = card.get("title") or card.get("message") or "Intervention notification"
    metadata = {
        "user_id": str(log.user_id),
        "snapshot_id": str(log.id),
        "provider": settings.notifications_provider,
        "llm_input_text": (input_summary or "")[:500],
    }
    metadata.update({k: v for k, v in extra.items() if v not in (None, "", [], {})})
    start = perf_counter()
    with trace(
        trace_name,
        metadata=metadata,
        user_id=str(log.user_id),
        request_id=request_id,
    ) as notification_trace:
        result = (
            service.notify_weekly_plan_ready(
                user_id=log.user_id,
                week_start=week_start or "",
                week_end=week_end or "",
                snapshot_id=log.id,
                request_id=request_id,
            )
            if job_name == "weekly_plan"
            else service.notify_intervention_ready(
                user_id=log.user_id,
                week_start=week_start or "",
                week_end=week_end or "",
                snapshot_id=log.id,
                flagged=_is_truthy(extra.get("flagged")),
                request_id=request_id,
            )
        )
    if notification_trace:
        message = getattr(result, "message", None) or result.reason or result.status
        summary_text = f"{job_name.title()} notification: {message}"
        notification_trace.update({"llm_output_text": summary_text[:500]})
    duration_ms = (perf_counter() - start) * 1000
    log_metric("notifications.sent", 1, metadata={"job": job_name, "provider": settings.notifications_provider})
    log_metric("notifications.duration_ms", duration_ms, metadata={"job": job_name})
    _record_notification_log(db, log, job_name, result=result, request_id=request_id, extra=extra)


def _record_notification_log(
    db: Session,
    log: AgentActionLog,
    job_name: str,
    *,
    result: NotificationResult,
    request_id: str | None,
    extra: dict,
) -> None:
    if result.status == "skipped":
        log_metric("notifications.skipped", 1, metadata={"job": job_name})
    payload = {
        "snapshot_log_id": str(log.id),
        "week_start": extra.get("week_start"),
        "week_end": extra.get("week_end"),
        "provider": settings.notifications_provider,
        "result": result.__dict__,
        "extras": extra,
        "request_id": request_id or "",
    }
    notification_log = AgentActionLog(
        user_id=log.user_id,
        action_type="notification_weekly_plan" if job_name == "weekly_plan" else "notification_intervention",
        action_payload=payload,
        reason="Notification dispatched" if result.status != "skipped" else "Notification skipped",
        undo_available=False,
    )
    db.add(notification_log)
    db.commit()


def _is_truthy(value) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        return value.lower() in {"true", "1", "yes"}
    return bool(value)
