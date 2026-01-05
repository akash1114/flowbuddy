"""Opik SDK client helpers."""
from __future__ import annotations

import logging
from threading import Lock
from typing import Optional

from app.core.config import settings

try:
    from opik import Opik
except ImportError:  # pragma: no cover
    Opik = None  # type: ignore[assignment]

logger = logging.getLogger(__name__)

_client: Optional["Opik"] = None
_client_lock = Lock()
_init_attempted = False


def init_opik() -> Optional["Opik"]:
    """Initialize the Opik client once and return it."""
    global _client, _init_attempted

    if Opik is None:
        return None

    with _client_lock:
        if _client is not None or _init_attempted:
            return _client
        _init_attempted = True

    if not settings.opik_enabled:
        return None

    if not settings.opik_api_key:
        logger.warning("OPIK_ENABLED is true but OPIK_API_KEY is missing; skipping Opik init.")
        return None

    try:
        client = Opik(project_name=settings.opik_project, api_key=settings.opik_api_key)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Failed to initialize Opik, tracing will be disabled: %s", exc)
        return None

    logger.info("Opik enabled (project=%s).", settings.opik_project)
    _client = client
    return _client


def get_opik_client() -> Optional["Opik"]:
    """Return the cached Opik client if tracing is enabled."""
    if _client is not None:
        return _client
    return init_opik()
