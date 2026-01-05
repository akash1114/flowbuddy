"""Resolution intake API routes."""
from __future__ import annotations

from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Dict, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.schemas.decomposition import (
    DecompositionRequest,
    DecompositionResponse,
    DraftTaskPayload,
    PlanPayload,
)
from app.api.schemas.resolution import ResolutionCreateRequest, ResolutionResponse
from app.db.deps import get_db
from app.db.models.resolution import Resolution
from app.db.models.task import Task
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.resolution_decomposer import DraftTaskSpec, decompose_resolution
from app.services.resolution_intake import derive_resolution_fields
from app.services.user_service import get_or_create_user

router = APIRouter()


@router.post("/resolutions", response_model=ResolutionResponse, status_code=status.HTTP_201_CREATED, tags=["resolutions"])
def create_resolution_endpoint(
    payload: ResolutionCreateRequest,
    http_request: Request,
    db: Session = Depends(get_db),
) -> ResolutionResponse:
    """Store a new resolution derived from free text."""
    user_id = payload.user_id
    text = payload.text
    duration_weeks = payload.duration_weeks
    text_length = len(text)
    request_id = getattr(http_request.state, "request_id", None)

    base_metadata: Dict[str, Any] = {
        "route": "/resolutions",
        "user_id": str(user_id),
        "text_length": text_length,
        "duration_weeks": duration_weeks,
        "request_id": request_id,
    }

    classified_type = "other"
    success = False
    resolution: Resolution | None = None

    try:
        with trace(
            "resolution.intake",
            metadata=base_metadata,
            user_id=str(user_id),
            request_id=request_id,
        ) as span:
            get_or_create_user(db, user_id)
            derived = derive_resolution_fields(text)
            classified_type = derived.type

            resolution = Resolution(
                user_id=user_id,
                title=derived.title,
                type=classified_type,
                duration_weeks=duration_weeks,
                status="draft",
                metadata_json={"raw_text": text},
            )
            db.add(resolution)
            try:
                db.commit()
            except IntegrityError as exc:
                db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to save resolution",
                ) from exc
            db.refresh(resolution)
            success = True

            if span:
                try:
                    span.update(metadata={**base_metadata, "classified_type": classified_type})
                except Exception:
                    pass
    finally:
        metric_metadata = {"user_id": str(user_id), "type": classified_type}
        if duration_weeks is not None:
            metric_metadata["duration_weeks"] = duration_weeks

        log_metric("resolution.intake.text_length", text_length, metadata=metric_metadata)
        log_metric("resolution.intake.success", 1 if success else 0, metadata=metric_metadata)
        log_metric("resolution.intake.classified_type", 1, metadata=metric_metadata)

    if not resolution:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Resolution not created")

    return ResolutionResponse(
        id=resolution.id,
        user_id=resolution.user_id,
        title=resolution.title,
        raw_text=text,
        type=resolution.type,
        duration_weeks=resolution.duration_weeks,
        status=resolution.status,
        request_id=request_id or "",
    )


@router.post(
    "/resolutions/{resolution_id}/decompose",
    response_model=DecompositionResponse,
    tags=["resolutions"],
)
def decompose_resolution_endpoint(
    resolution_id: UUID,
    http_request: Request,
    payload: DecompositionRequest | None = None,
    db: Session = Depends(get_db),
) -> DecompositionResponse:
    """Generate or return a multi-week plan plus draft week-one tasks."""
    params = payload or DecompositionRequest()
    resolution = db.get(Resolution, resolution_id)
    if not resolution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resolution not found")

    request_id = getattr(http_request.state, "request_id", None)
    metadata = dict(resolution.metadata_json or {})
    raw_text = metadata.get("raw_text") or resolution.title
    plan_weeks = _resolve_plan_weeks(params.weeks, resolution.duration_weeks)
    regenerate = params.regenerate

    base_metadata: Dict[str, Any] = {
        "route": f"/resolutions/{resolution_id}/decompose",
        "resolution_id": str(resolution_id),
        "user_id": str(resolution.user_id),
        "duration_weeks": resolution.duration_weeks,
        "plan_weeks": plan_weeks,
        "regenerate": regenerate,
        "request_id": request_id,
    }

    start_time = perf_counter()
    success = False
    tasks_generated = 0
    plan_payload: Dict[str, Any]
    task_models: List[Task] = []

    try:
        with trace(
            "resolution.decomposition",
            metadata=base_metadata,
            user_id=str(resolution.user_id),
            request_id=request_id,
        ) as span:
            existing_plan = metadata.get("plan_v1")
            existing_tasks = _fetch_draft_tasks(db, resolution.id)

            if existing_plan and existing_tasks and not regenerate:
                plan_payload = existing_plan
                task_models = existing_tasks
            else:
                try:
                    plan_payload, task_models, new_type = _prepare_plan_and_tasks(
                        db=db,
                        resolution=resolution,
                        metadata=metadata,
                        raw_text=raw_text,
                        plan_weeks=plan_weeks,
                        regenerate=regenerate,
                    )
                    if new_type and (resolution.type == "other" or not resolution.type):
                        resolution.type = new_type
                    db.commit()
                except IntegrityError as exc:
                    db.rollback()
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Failed to store decomposition",
                    ) from exc
                except Exception:
                    db.rollback()
                    raise

            tasks_generated = len(task_models)
            success = True

            if span:
                try:
                    span.update(metadata={**base_metadata, "tasks_generated": tasks_generated})
                except Exception:
                    pass
    finally:
        latency_ms = (perf_counter() - start_time) * 1000
        metric_metadata = {
            "resolution_id": str(resolution_id),
            "user_id": str(resolution.user_id),
            "regenerate": regenerate,
            "tasks_generated": tasks_generated,
        }
        if resolution.duration_weeks is not None:
            metric_metadata["duration_weeks"] = resolution.duration_weeks

        log_metric("resolution.decomposition.success", 1 if success else 0, metadata=metric_metadata)
        log_metric("resolution.decomposition.tasks_generated", tasks_generated, metadata=metric_metadata)
        log_metric("resolution.decomposition.latency_ms", latency_ms, metadata=metric_metadata)

    response_plan = PlanPayload(**plan_payload)
    response_tasks = [_serialize_task(task) for task in task_models]

    return DecompositionResponse(
        resolution_id=resolution.id,
        user_id=resolution.user_id,
        title=resolution.title,
        type=resolution.type,
        duration_weeks=resolution.duration_weeks,
        plan=response_plan,
        week_1_tasks=response_tasks,
        request_id=request_id or "",
    )


def _prepare_plan_and_tasks(
    db: Session,
    resolution: Resolution,
    metadata: Dict[str, Any],
    raw_text: str,
    plan_weeks: int,
    regenerate: bool,
) -> tuple[Dict[str, Any], List[Task], str]:
    if regenerate:
        _delete_existing_draft_tasks(db, resolution.id)
    decomposition = decompose_resolution(raw_text, resolution.title, resolution.type, plan_weeks)
    metadata["plan_v1"] = decomposition.plan
    metadata["plan_generated_at"] = datetime.now(timezone.utc).isoformat()
    resolution.metadata_json = metadata
    tasks = _create_tasks_from_specs(resolution, decomposition.week_one_tasks)
    for task in tasks:
        db.add(task)
    return decomposition.plan, tasks, decomposition.resolution_type


def _resolve_plan_weeks(request_weeks: int | None, duration_weeks: int | None) -> int:
    if request_weeks:
        return max(4, min(12, request_weeks))
    if duration_weeks:
        return max(4, min(12, duration_weeks))
    return 8


def _fetch_draft_tasks(db: Session, resolution_id: UUID) -> List[Task]:
    tasks = (
        db.query(Task)
        .filter(Task.resolution_id == resolution_id)
        .order_by(Task.created_at.asc())
        .all()
    )
    return [task for task in tasks if _is_draft_task(task)]


def _delete_existing_draft_tasks(db: Session, resolution_id: UUID) -> None:
    tasks = _fetch_draft_tasks(db, resolution_id)
    for task in tasks:
        db.delete(task)
    if tasks:
        db.flush()


def _is_draft_task(task: Task) -> bool:
    metadata = task.metadata_json or {}
    return bool(metadata.get("draft")) and metadata.get("source") == "decomposer_v1"


def _create_tasks_from_specs(resolution: Resolution, specs: List[DraftTaskSpec]) -> List[Task]:
    tasks: List[Task] = []
    for spec in specs:
        extra_metadata = {k: v for k, v in (spec.metadata or {}).items() if v is not None}
        metadata = {"draft": True, "source": "decomposer_v1", "week": 1, **extra_metadata}
        task = Task(
            user_id=resolution.user_id,
            resolution_id=resolution.id,
            title=spec.title,
            scheduled_day=spec.scheduled_day,
            scheduled_time=spec.scheduled_time,
            duration_min=spec.duration_min,
            metadata_json=metadata,
        )
        tasks.append(task)
    return tasks


def _serialize_task(task: Task) -> DraftTaskPayload:
    return DraftTaskPayload(
        id=task.id,
        title=task.title,
        scheduled_day=task.scheduled_day,
        scheduled_time=task.scheduled_time,
        duration_min=task.duration_min,
        draft=True,
    )
