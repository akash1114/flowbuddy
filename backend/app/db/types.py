"""Database column type helpers."""
from __future__ import annotations

from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON, TypeDecorator


class JSONBCompat(TypeDecorator):
    """JSONB that falls back to native JSON on dialects like SQLite (for tests)."""

    impl = JSONB
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "sqlite":  # pragma: no cover - dialect specific
            return dialect.type_descriptor(JSON())
        return dialect.type_descriptor(JSONB())
