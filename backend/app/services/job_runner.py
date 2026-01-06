"""Batch job runners for weekly plans and interventions."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable, List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models.resolution import Resolution
from app.db.models.user_preferences import UserPreferences
from app.services.weekly_planner import (
    get_weekly_plan_preview,
    persist_weekly_plan_preview,
)
from app.services.intervention_service import (
    get_intervention_preview,
    persist_intervention_preview,
)
from app.services.notifications.hooks import (
    notify_weekly_plan_snapshot,
    notify_intervention_snapshot,
)


logger = logging.getLogger(__name__)


@dataclass
class JobRunResult:
    users_processed: int
    snapshots_written: int
    skipped_due_to_preferences: int = 0


@dataclass
class PreferenceState:
    coaching_paused: bool
    weekly_plans_enabled: bool
    interventions_enabled: bool


DEFAULT_PREFS = PreferenceState(False, True, True)


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
    if result.created:
        notify_weekly_plan_snapshot(db, result.log, None)
    return result.created


def run_weekly_plan_for_all_users(
    db: Session,
    *,
    user_ids: Optional[Iterable[UUID]] = None,
    force: bool = False,
) -> JobRunResult:
    ids = _normalize_user_ids(user_ids, db)
    prefs_map = _load_preferences_map(db, ids)
    users_processed = 0
    snapshots_written = 0
    skipped = 0
    for uid in ids:
        prefs = prefs_map.get(uid, DEFAULT_PREFS)
        if prefs.coaching_paused or not prefs.weekly_plans_enabled:
            skipped += 1
            logger.debug("Skipping weekly plan for user %s due to preferences", uid)
            continue
        try:
            created = run_weekly_plan_for_user(db, uid, force=force)
        except Exception:  # pragma: no cover - defensive guard
            logger.exception("Weekly plan job failed for user %s", uid)
            continue
        users_processed += 1
        if created:
            snapshots_written += 1
    return JobRunResult(users_processed=users_processed, snapshots_written=snapshots_written, skipped_due_to_preferences=skipped)


def run_interventions_for_user(db: Session, user_id: UUID, *, force: bool = False) -> bool:
    preview = get_intervention_preview(db, user_id)
    result = persist_intervention_preview(
        db,
        user_id=user_id,
        preview=preview,
        request_id=None,
        force=force,
    )
    if result.created:
        notify_intervention_snapshot(db, result.log, None)
    return result.created


def run_interventions_for_all_users(
    db: Session,
    *,
    user_ids: Optional[Iterable[UUID]] = None,
    force: bool = False,
) -> JobRunResult:
    ids = _normalize_user_ids(user_ids, db)
    prefs_map = _load_preferences_map(db, ids)
    users_processed = 0
    snapshots_written = 0
    skipped = 0
    for uid in ids:
        prefs = prefs_map.get(uid, DEFAULT_PREFS)
        if prefs.coaching_paused or not prefs.interventions_enabled:
            skipped += 1
            logger.debug("Skipping interventions for user %s due to preferences", uid)
            continue
        try:
            created = run_interventions_for_user(db, uid, force=force)
        except Exception:  # pragma: no cover - defensive guard
            logger.exception("Intervention job failed for user %s", uid)
            continue
        users_processed += 1
        if created:
            snapshots_written += 1
    return JobRunResult(users_processed=users_processed, snapshots_written=snapshots_written, skipped_due_to_preferences=skipped)


def _normalize_user_ids(user_ids: Optional[Iterable[UUID]], db: Session) -> List[UUID]:
    if user_ids is None:
        ids = _active_user_ids(db)
    else:
        ids = list(dict.fromkeys(user_ids))
    return ids


def _load_preferences_map(db: Session, user_ids: List[UUID]) -> dict[UUID, PreferenceState]:
    if not user_ids:
        return {}
    rows = (
        db.query(UserPreferences)
        .filter(UserPreferences.user_id.in_(user_ids))
        .all()
    )
    mapping: dict[UUID, PreferenceState] = {}
    for row in rows:
        mapping[row.user_id] = PreferenceState(
            coaching_paused=bool(row.coaching_paused),
            weekly_plans_enabled=bool(row.weekly_plans_enabled),
            interventions_enabled=bool(row.interventions_enabled),
        )
    return mapping
