"""Per-request context utilities."""
from __future__ import annotations

from contextvars import ContextVar

request_id_ctx_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    """Return the current request id if available."""
    return request_id_ctx_var.get()
