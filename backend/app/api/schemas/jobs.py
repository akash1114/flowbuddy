"""Schemas for job operations endpoints."""
from __future__ import annotations

from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel


class JobRunRequest(BaseModel):
    job: Literal["weekly_plan", "interventions"]
    user_id: Optional[UUID] = None
    force: bool = False


class JobRunResponse(BaseModel):
    job: str
    users_processed: int
    snapshots_written: int
    request_id: str
