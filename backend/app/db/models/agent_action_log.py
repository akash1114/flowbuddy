"""Agent action log ORM model."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Text, func, text as sa_text
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base
from app.db.types import JSONBCompat


class AgentActionLog(Base):
    __tablename__ = "agent_actions_log"
    __table_args__ = (Index("ix_agent_actions_log_user_id", "user_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    action_type = Column(Text, nullable=False)
    action_payload = Column(JSONBCompat, nullable=False, default=dict)
    reason = Column(Text, nullable=True)
    undo_available = Column(Boolean, nullable=False, server_default=sa_text("false"))
    undone_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
