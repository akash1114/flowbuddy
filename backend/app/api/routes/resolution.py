"""Resolution intake API routes."""
from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.schemas.resolution import ResolutionCreateRequest, ResolutionResponse
from app.db.deps import get_db
from app.db.models.resolution import Resolution
from app.observability.metrics import log_metric
from app.observability.tracing import trace
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
