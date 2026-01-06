"""Notification service factory."""
from __future__ import annotations

from functools import lru_cache

from app.core.config import settings
from app.services.notifications.base import NotificationService
from app.services.notifications.noop import NoopNotificationService


@lru_cache
def get_notification_service() -> NotificationService:
    provider = settings.notifications_provider.lower()
    if provider == "noop":
        return NoopNotificationService()
    # Future providers can be added here
    return NoopNotificationService()
