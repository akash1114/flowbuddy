"""Lightweight metrics helpers."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from app.observability.tracing import trace

logger = logging.getLogger(__name__)


def log_metric(name: str, value: float | int, metadata: Optional[Dict[str, Any]] = None) -> None:
    """Log a metric to Opik if it is enabled."""
    payload: Dict[str, Any] = {"value": value}
    if metadata:
        payload.update(metadata)

    try:
        with trace(name=f"metric:{name}", metadata=payload):
            pass
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Unable to record metric %s: %s", name, exc)
