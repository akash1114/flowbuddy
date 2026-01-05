"""Task ORM model."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, Text, Time, func, text as sa_text
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base
from app.db.types import JSONBCompat


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_user_id", "user_id"),
        Index("ix_tasks_resolution_id", "resolution_id"),
        Index("ix_tasks_completed", "completed"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    resolution_id = Column(
        UUID(as_uuid=True),
        ForeignKey("resolutions.id", ondelete="SET NULL"),
        nullable=True,
    )
    title = Column(Text, nullable=False)
    scheduled_day = Column(Date, nullable=True)
    scheduled_time = Column(Time(timezone=True), nullable=True)
    duration_min = Column(Integer, nullable=True)
    completed = Column(Boolean, nullable=False, server_default=sa_text("false"))
    completed_at = Column(DateTime(timezone=True), nullable=True)
    # Column named "metadata" but attribute renamed to avoid Base.metadata collisions.
    metadata_json = Column("metadata", JSONBCompat, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
