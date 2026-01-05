"""Schemas for task listing."""
from __future__ import annotations

from datetime import date, time, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class TaskSummary(BaseModel):
    id: UUID
    resolution_id: Optional[UUID]
    title: str
    scheduled_day: Optional[date]
    scheduled_time: Optional[time]
    duration_min: Optional[int]
    completed: bool
    note: Optional[str]
    created_at: datetime
    updated_at: datetime
    source: str


class TaskUpdateRequest(BaseModel):
    user_id: UUID
    completed: bool


class TaskUpdateResponse(BaseModel):
    id: UUID
    completed: bool
    completed_at: Optional[datetime]
    request_id: str


class TaskNoteUpdateRequest(BaseModel):
    user_id: UUID
    note: Optional[str]


class TaskNoteUpdateResponse(BaseModel):
    id: UUID
    note: Optional[str]
    request_id: str
