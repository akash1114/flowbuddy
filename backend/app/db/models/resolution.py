"""Resolution ORM model."""
from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, func, text as sa_text
from sqlalchemy.dialects.postgresql import UUID

from app.db.base import Base
from app.db.types import JSONBCompat


class Resolution(Base):
    __tablename__ = "resolutions"
    __table_args__ = (Index("ix_resolutions_user_id", "user_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(Text, nullable=False)
    type = Column(String(length=50), nullable=False)
    duration_weeks = Column(Integer, nullable=True)
    status = Column(String(length=50), nullable=False, server_default=sa_text("'draft'::text"))
    # Column named "metadata" but attribute renamed to avoid Base.metadata collisions.
    metadata_json = Column("metadata", JSONBCompat, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
