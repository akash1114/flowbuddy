"""Schemas for dashboard endpoint."""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class WeekWindow(BaseModel):
    start: date
    end: date


class TaskStats(BaseModel):
    total: int
    completed: int
    scheduled: int
    unscheduled: int


class RecentActivity(BaseModel):
    task_id: UUID
    title: str
    completed: bool
    completed_at: Optional[datetime]
    note_present: bool


class DashboardResolution(BaseModel):
    resolution_id: UUID
    title: str
    type: str
    duration_weeks: Optional[int]
    status: str
    week: WeekWindow
    tasks: TaskStats
    completion_rate: float
    recent_activity: List[RecentActivity]


class DashboardResponse(BaseModel):
    user_id: UUID
    active_resolutions: List[DashboardResolution]
    request_id: str
