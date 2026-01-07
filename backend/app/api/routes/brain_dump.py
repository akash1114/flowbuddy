"""Brain dump API routes."""
from __future__ import annotations

from typing import Any, Dict
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.schemas.brain_dump import BrainDumpRequest, BrainDumpResponse, BrainDumpSignals
from app.db.deps import get_db
from app.db.models.brain_dump import BrainDump
from app.db.models.agent_action_log import AgentActionLog
from app.observability.metrics import log_metric
from app.observability.tracing import trace
from app.services.brain_dump_extractor import ExtractionResult, extract_signals
from app.services.user_service import get_or_create_user

router = APIRouter()

ACK_ACTIONABLE = "Thanks for sharing. I've saved this. If you want, we can pick one small thing to focus on."
ACK_NEUTRAL = "Got it — I've captured that. Want help turning any of it into a tiny next step?"


@router.post("/brain-dump", response_model=BrainDumpResponse, tags=["brain-dump"])
def ingest_brain_dump(request: BrainDumpRequest, http_request: Request, db: Session = Depends(get_db)) -> BrainDumpResponse:
    """Persist a brain dump and return extracted signals."""
    user_id: UUID = request.user_id
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="text must not be empty")
    text_length = len(text)
    request_id = getattr(http_request.state, "request_id", None)

    base_metadata: Dict[str, Any] = {
        "route": "/brain-dump",
        "user_id": str(user_id),
        "text_length": text_length,
    }

    extractor_result = _default_extraction()

    with trace("brain_dump.processing", metadata=base_metadata, user_id=str(user_id), request_id=request_id) as span:
        user = get_or_create_user(db, user_id)

        try:
            extractor_result = extract_signals(text)
        except Exception:  # pragma: no cover - defensive hook
            extractor_result = _default_extraction()

        span_metadata = {**base_metadata, "actionable": extractor_result.actionable}
        if span:
            try:
                span.update(metadata=span_metadata)
            except Exception:  # pragma: no cover - best-effort
                pass

        log_metric("brain_dump.text_length", text_length, metadata={"user_id": str(user_id)})
        log_metric("brain_dump.actionable", 1 if extractor_result.actionable else 0, metadata={"user_id": str(user_id)})
        log_metric("brain_dump.extractor.success", 1 if extractor_result.success else 0, metadata={"user_id": str(user_id)})

        span_metadata = {**base_metadata, "actionable": extractor_result.actionable}
        if span:  # pragma: no branch - simple guard
            try:
                span.update(metadata=span_metadata)
            except Exception:
                pass

        brain_dump = BrainDump(
            user_id=user_id,
            body=text,
            signals_extracted=extractor_result.signals,
            actionable=extractor_result.actionable,
        )
        db.add(brain_dump)
        db.flush()

        log_entry = AgentActionLog(
            user_id=user_id,
            action_type="brain_dump_ingested",
            action_payload={
                "brain_dump_id": str(brain_dump.id),
                "actionable": extractor_result.actionable,
                "signals": extractor_result.signals,
                "request_id": request_id,
            },
            reason="Brain dump captured",
            undo_available=False,
        )
        db.add(log_entry)
        try:
            db.commit()
        except IntegrityError as exc:  # pragma: no cover - DB constraint guard
            db.rollback()
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save brain dump") from exc
        db.refresh(brain_dump)

    response_signals = BrainDumpSignals(**extractor_result.signals)
    acknowledgement = ACK_ACTIONABLE if extractor_result.actionable else ACK_NEUTRAL
    return BrainDumpResponse(
        id=brain_dump.id,
        acknowledgement=acknowledgement,
        signals=response_signals,
        actionable=extractor_result.actionable,
    )


def _default_extraction() -> ExtractionResult:
    return ExtractionResult(
        signals={
            "emotional_state": None,
            "blockers": [],
            "resolution_refs": [],
            "intent_shift": None,
        },
        actionable=False,
        success=False,
    )
