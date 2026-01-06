"""Batch job runners for weekly plans and interventions."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models.resolution import Resolution
from app.services.weekly_planner import (
    get_weekly_plan_preview,
    persist_weekly_plan_preview,
)
from app.services.intervention_service import (
    get_intervention_preview,
    persist_intervention_preview,
)


logger = logging.getLogger(__name__)


@dataclass
class JobRunResult:
    users_processed: int
    snapshots_written: int


def _active_user_ids(db: Session) -> List[UUID]:
    rows = (
        db.query(Resolution.user_id)
        .filter(Resolution.status == "active")
        .distinct()
        .all()
    )
    return [row[0] for row in rows]


def run_weekly_plan_for_user(db: Session, user_id: UUID, *, force: bool = False) -> bool:
    preview = get_weekly_plan_preview(db, user_id)
    result = persist_weekly_plan_preview(
        db,
        user_id=user_id,
        preview=preview,
        request_id=None,
        force=force,
    )
    return result.created


def run_weekly_plan_for_all_users(
    db: Session,
    *,
    user_ids: Optional[Iterable[UUID]] = None,
    force: bool = False,
) -> JobRunResult:
    ids = _normalize_user_ids(user_ids, db)
    users_processed = 0
    snapshots_written = 0
    for uid in ids:
        try:
            created = run_weekly_plan_for_user(db, uid, force=force)
        except Exception:  # pragma: no cover - defensive guard
            logger.exception("Weekly plan job failed for user %s", uid)
            continue
        users_processed += 1
        if created:
            snapshots_written += 1
    return JobRunResult(users_processed=users_processed, snapshots_written=snapshots_written)


def run_interventions_for_user(db: Session, user_id: UUID, *, force: bool = False) -> bool:
    preview = get_intervention_preview(db, user_id)
    result = persist_intervention_preview(
        db,
        user_id=user_id,
        preview=preview,
        request_id=None,
        force=force,
    )
    return result.created


def run_interventions_for_all_users(
    db: Session,
    *,
    user_ids: Optional[Iterable[UUID]] = None,
    force: bool = False,
) -> JobRunResult:
    ids = _normalize_user_ids(user_ids, db)
    users_processed = 0
    snapshots_written = 0
    for uid in ids:
        try:
            created = run_interventions_for_user(db, uid, force=force)
        except Exception:  # pragma: no cover - defensive guard
            logger.exception("Intervention job failed for user %s", uid)
            continue
        users_processed += 1
        if created:
            snapshots_written += 1
    return JobRunResult(users_processed=users_processed, snapshots_written=snapshots_written)


def _normalize_user_ids(user_ids: Optional[Iterable[UUID]], db: Session) -> List[UUID]:
    if user_ids is None:
        ids = _active_user_ids(db)
    else:
        ids = list(dict.fromkeys(user_ids))
    return ids
