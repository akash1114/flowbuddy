"""No-op notification provider (logs only)."""
from __future__ import annotations

import logging
from uuid import UUID

from app.services.notifications.base import NotificationResult, NotificationService


logger = logging.getLogger(__name__)


class NoopNotificationService(NotificationService):
    def notify_weekly_plan_ready(
        self,
        *,
        user_id: UUID,
        week_start: str,
        week_end: str,
        snapshot_id: UUID,
        request_id: str | None,
    ) -> NotificationResult:
        logger.info(
            "Notification queued (noop) weekly_plan user=%s week=%s-%s snapshot=%s",
            user_id,
            week_start,
            week_end,
            snapshot_id,
        )
        return NotificationResult(status="noop", reason="notification provider is noop")

    def notify_intervention_ready(
        self,
        *,
        user_id: UUID,
        week_start: str,
        week_end: str,
        snapshot_id: UUID,
        flagged: bool,
        request_id: str | None,
    ) -> NotificationResult:
        logger.info(
            "Notification queued (noop) interventions user=%s week=%s-%s snapshot=%s flagged=%s",
            user_id,
            week_start,
            week_end,
            snapshot_id,
            flagged,
        )
        return NotificationResult(status="noop", reason="notification provider is noop")
