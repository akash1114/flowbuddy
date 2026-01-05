"""Helpers for working with users."""
from __future__ import annotations

from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models.user import User


def get_or_create_user(db: Session, user_id: UUID) -> User:
    """Fetch an existing user or create a new row safely."""
    user = db.get(User, user_id)
    if user:
        return user

    user = User(id=user_id)
    db.add(user)
    try:
        db.flush()
        return user
    except IntegrityError:
        db.rollback()
        existing = db.get(User, user_id)
        if existing:
            return existing
        raise
