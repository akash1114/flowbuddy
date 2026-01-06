"""Regression tests for application route registration."""
from fastapi.routing import APIRoute

from app.main import app


def test_dashboard_route_registered_once() -> None:
    """Ensure the dashboard endpoint is not mounted multiple times."""
    dashboard_routes = [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path == "/dashboard" and "GET" in route.methods
    ]
    assert len(dashboard_routes) == 1
