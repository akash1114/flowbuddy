"""Tracing utilities wrapping Opik."""
from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any, Dict, Iterator, Optional

from app.observability.client import get_opik_client

if TYPE_CHECKING:  # pragma: no cover - typing helper
    from opik.api_objects.trace.trace_client import Trace
else:  # pragma: no cover - typing helper
    Trace = object  # type: ignore[assignment]

logger = logging.getLogger(__name__)


@contextmanager
def trace(
    name: str,
    metadata: Optional[Dict[str, Any]] = None,
    user_id: Optional[str] = None,
    request_id: Optional[str] = None,
) -> Iterator[Optional["Trace"]]:
    """
    Create an Opik trace context manager.

    When Opik is disabled or unavailable the context is a no-op.
    """
    client = get_opik_client()
    opik_trace: Optional["Trace"] = None

    if client:
        trace_metadata = dict(metadata or {})
        if user_id:
            trace_metadata.setdefault("user_id", str(user_id))
        if request_id:
            trace_metadata.setdefault("request_id", request_id)
        try:
            opik_trace = client.trace(name=name, metadata=trace_metadata or None)
        except Exception as exc:  # pragma: no cover - defensive guard
            logger.debug("Unable to start Opik trace %s: %s", name, exc)
            opik_trace = None

    try:
        yield opik_trace
    except Exception as exc:
        if opik_trace:
            try:
                opik_trace.update(error_info={"message": str(exc)})
            except Exception:  # pragma: no cover
                logger.debug("Failed to attach error info to Opik trace %s", name, exc_info=True)
        raise
    finally:
        if opik_trace:
            try:
                opik_trace.end()
            except Exception:  # pragma: no cover
                logger.debug("Failed to close Opik trace %s cleanly", name, exc_info=True)
