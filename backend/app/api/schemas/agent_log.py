"""Schemas for agent action log transparency endpoints."""
from __future__ import annotations

from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel


class AgentLogListItem(BaseModel):
    id: UUID
    created_at: str
    action_type: str
    undo_available: bool
    summary: str
    request_id: Optional[str] = None


class AgentLogListResponse(BaseModel):
    user_id: UUID
    items: List[AgentLogListItem]
    next_cursor: Optional[str]
    request_id: str


class AgentLogDetailResponse(BaseModel):
    id: UUID
    user_id: UUID
    created_at: str
    action_type: str
    undo_available: bool
    payload: Dict[str, Any]
    summary: str
    request_id: Optional[str] = None
    request_id_header: str
