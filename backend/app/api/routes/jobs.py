"""Operational endpoints for scheduler jobs."""
from __future__ import annotations

from time import perf_counter

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.schemas.jobs import JobRunRequest, JobRunResponse
from app.core.config import settings
from app.db.deps import get_db
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.job_runner import (
    run_interventions_for_all_users,
    run_interventions_for_user,
    run_weekly_plan_for_all_users,
    run_weekly_plan_for_user,
)

router = APIRouter()


@router.get("/jobs", tags=["jobs"])
def get_jobs_config(request: Request) -> dict:
    request_id = getattr(request.state, "request_id", None)
    with trace("jobs.config", metadata={"request_id": request_id}, request_id=request_id):
        data = {
            "scheduler_enabled": settings.scheduler_enabled,
            "schedule": {
                "timezone": settings.scheduler_timezone,
                "weekly_day": settings.weekly_job_day,
                "weekly_time": f"{settings.weekly_job_hour:02d}:{settings.weekly_job_minute:02d}",
            },
        }
    return {**data, "request_id": request_id or ""}


@router.post("/jobs/run-now", response_model=JobRunResponse, tags=["jobs"])
def run_job_now(
    request: Request,
    payload: JobRunRequest,
    db: Session = Depends(get_db),
) -> JobRunResponse:
    if not settings.debug:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Run-now only allowed in debug mode")

    request_id = getattr(request.state, "request_id", None)
    metadata = {"job": payload.job, "request_id": request_id}
    start = perf_counter()
    with trace("jobs.run_now", metadata=metadata, request_id=request_id):
        if payload.job == "weekly_plan":
            result = _run_weekly_job(db, payload.user_id, payload.force)
        else:
            result = _run_intervention_job(db, payload.user_id, payload.force)

    latency_ms = (perf_counter() - start) * 1000
    log_metric(
        "jobs.run_now.success",
        1,
        metadata={"job": payload.job},
    )
    log_metric(
        "jobs.run_now.latency_ms",
        latency_ms,
        metadata={"job": payload.job},
    )

    return JobRunResponse(
        job=payload.job,
        users_processed=result["users_processed"],
        snapshots_written=result["snapshots_written"],
        request_id=request_id or "",
    )


def _run_weekly_job(db: Session, user_id, force: bool) -> dict:
    if user_id:
        try:
            created = run_weekly_plan_for_user(db, user_id, force=force)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return {"users_processed": 1, "snapshots_written": 1 if created else 0}
    res = run_weekly_plan_for_all_users(db, force=force)
    return {
        "users_processed": res.users_processed,
        "snapshots_written": res.snapshots_written,
    }


def _run_intervention_job(db: Session, user_id, force: bool) -> dict:
    if user_id:
        try:
            created = run_interventions_for_user(db, user_id, force=force)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return {"users_processed": 1, "snapshots_written": 1 if created else 0}
    res = run_interventions_for_all_users(db, force=force)
    return {
        "users_processed": res.users_processed,
        "snapshots_written": res.snapshots_written,
    }
