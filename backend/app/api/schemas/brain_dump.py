"""Pydantic schemas for brain dump API."""
from __future__ import annotations

from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class BrainDumpRequest(BaseModel):
    user_id: UUID
    text: str = Field(..., min_length=1, max_length=2000)


class BrainDumpSignals(BaseModel):
    emotional_state: Optional[str] = None
    blockers: List[str] = Field(default_factory=list)
    resolution_refs: List[str] = Field(default_factory=list)
    intent_shift: Optional[str] = None


class BrainDumpResponse(BaseModel):
    id: UUID
    acknowledgement: str
    signals: BrainDumpSignals
    actionable: bool
