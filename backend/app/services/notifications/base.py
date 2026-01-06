"""Notification service interface."""
from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID


@dataclass
class NotificationResult:
    status: str
    reason: str


class NotificationService:
    """Base interface for notification providers."""

    def notify_weekly_plan_ready(
        self,
        *,
        user_id: UUID,
        week_start: str,
        week_end: str,
        snapshot_id: UUID,
        request_id: str | None,
    ) -> NotificationResult:
        raise NotImplementedError

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
        raise NotImplementedError
