"""Main FastAPI application for FlowBuddy backend."""
from fastapi import FastAPI, Request

from app.api.routes.brain_dump import router as brain_dump_router
from app.api.routes.resolution import router as resolution_router
from app.api.routes.resolutions_approve import router as resolutions_approve_router
from app.api.routes.resolutions_decompose import router as resolutions_decompose_router
from app.api.routes.resolutions_intake import router as resolutions_intake_router
from app.api.routes.task import router as task_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.weekly_plan import router as weekly_plan_router
from app.api.routes.interventions import router as interventions_router
from app.api.routes.preferences import router as preferences_router
from app.api.routes.jobs import router as jobs_router
from app.api.routes.notifications import router as notifications_router
from app.core.config import settings
from app.core.logging import configure_logging
from app.core.middleware import RequestIDMiddleware
from app.observability.client import init_opik
from app.observability.tracing import trace

configure_logging(log_level=settings.log_level)

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(RequestIDMiddleware)
app.include_router(brain_dump_router)
app.include_router(resolution_router)
app.include_router(resolutions_intake_router)
app.include_router(resolutions_decompose_router)
app.include_router(resolutions_approve_router)
app.include_router(task_router)
app.include_router(dashboard_router)
app.include_router(weekly_plan_router)
app.include_router(interventions_router)
app.include_router(jobs_router)
app.include_router(preferences_router)
app.include_router(notifications_router)


@app.on_event("startup")
async def startup_observability() -> None:
    """Initialize observability backends after the event loop starts."""
    init_opik()


@app.get("/health", tags=["health"], summary="Readiness probe")
async def health_check(request: Request) -> dict[str, str]:
    """Return a simple status payload so automation can probe the API."""
    with trace("http.health_check", metadata={"route": "/health"}, request_id=request.state.request_id):
        return {"status": "ok"}
