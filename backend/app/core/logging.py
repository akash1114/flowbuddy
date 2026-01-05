"""Centralized logging configuration."""
from __future__ import annotations

import logging
from logging.config import dictConfig

from app.core.context import get_request_id

class RequestIdFilter(logging.Filter):
    """Add request_id attribute to log records."""

    def filter(self, record: logging.LogRecord) -> bool:  # pragma: no cover - minimal logic
        record.request_id = get_request_id() or "-"
        return True


def configure_logging(*, log_level: str = "INFO") -> None:
    """Configure application logging once at startup."""
    if getattr(configure_logging, "_configured", False):
        return

    dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "default": {
                    "format": "%(asctime)s | %(levelname)s | %(name)s | %(request_id)s | %(message)s",
                }
            },
            "filters": {
                "request_id": {
                    "()": "app.core.logging.RequestIdFilter",
                }
            },
            "handlers": {
                "console": {
                    "class": "logging.StreamHandler",
                    "formatter": "default",
                    "level": log_level,
                    "filters": ["request_id"],
                }
            },
            "root": {
                "handlers": ["console"],
                "level": log_level,
            },
        }
    )

    logging.getLogger(__name__).debug("Logging configured at %s", log_level)
    setattr(configure_logging, "_configured", True)
