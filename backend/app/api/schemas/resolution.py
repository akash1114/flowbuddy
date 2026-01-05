"""Schemas for resolution intake API."""
from __future__ import annotations

from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class ResolutionCreateRequest(BaseModel):
    user_id: UUID
    text: str = Field(..., min_length=5, max_length=300)
    duration_weeks: Optional[int] = Field(default=None, ge=1, le=52)

    @field_validator("text")
    @classmethod
    def trim_and_validate_text(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 5 or len(cleaned) > 300:
            raise ValueError("text must be between 5 and 300 characters after trimming")
        return cleaned


class ResolutionResponse(BaseModel):
    id: UUID
    user_id: UUID
    title: str
    raw_text: str
    type: Literal["habit", "project", "learning", "health", "finance", "other"]
    duration_weeks: Optional[int]
    status: Literal["draft"]
    request_id: str
