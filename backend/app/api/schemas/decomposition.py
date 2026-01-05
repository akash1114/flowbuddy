"""Schemas for resolution decomposition endpoint."""
from __future__ import annotations

from datetime import date, time
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class DecompositionRequest(BaseModel):
    weeks: Optional[int] = Field(default=None, ge=4, le=12)
    regenerate: bool = False


class PlanMilestone(BaseModel):
    week: int
    focus: str
    success_criteria: List[str]


class PlanPayload(BaseModel):
    weeks: int
    milestones: List[PlanMilestone]


class DraftTaskPayload(BaseModel):
    id: UUID
    title: str
    scheduled_day: Optional[date] = None
    scheduled_time: Optional[time] = None
    duration_min: Optional[int] = None
    draft: bool = True


class DecompositionResponse(BaseModel):
    resolution_id: UUID
    user_id: UUID
    title: str
    type: str
    duration_weeks: Optional[int]
    plan: PlanPayload
    week_1_tasks: List[DraftTaskPayload]
    request_id: str
