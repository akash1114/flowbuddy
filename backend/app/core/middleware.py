"""Custom FastAPI middleware."""
from __future__ import annotations

from typing import Callable
from uuid import uuid4

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.context import request_id_ctx_var


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Populate request.state.request_id and ensure response header exists."""

    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:  # type: ignore[override]
        request_id = request.headers.get("X-Request-Id") or str(uuid4())
        request.state.request_id = request_id
        token = request_id_ctx_var.set(request_id)

        try:
            response = await call_next(request)
        finally:
            request_id_ctx_var.reset(token)

        response.headers["X-Request-Id"] = request_id
        return response
