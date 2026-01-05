"""BrainDump ORM model."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Text, func, text as sa_text
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base
from app.db.types import JSONBCompat


class BrainDump(Base):
    __tablename__ = "brain_dumps"
    __table_args__ = (Index("ix_brain_dumps_user_id", "user_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    body = Column("text", Text, nullable=False)
    signals_extracted = Column(JSONBCompat, nullable=False, default=dict)
    actionable = Column(Boolean, nullable=False, server_default=sa_text("false"))
    user_accepted_help = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
