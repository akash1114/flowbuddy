from __future__ import annotations

import os
import importlib
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.deps import get_db
from app.db.models.brain_dump import BrainDump
from app.db.models.user import User
from app.observability import client as client_module


class _DummyTrace:
    def __init__(self, metadata=None, **kwargs):
        self.metadata = metadata or {}

    def update(self, metadata=None, **kwargs):
        if metadata:
            self.metadata = metadata

    def end(self):
        pass


class _DummyOpik:
    def __init__(self, *args, **kwargs):
        self.traces = []

    def trace(self, **kwargs):
        trace = _DummyTrace(metadata=kwargs.get("metadata"))
        self.traces.append(trace)
        return trace


@pytest.fixture()
def sqlite_override():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )

    @event.listens_for(engine, "connect")
    def set_fk(conn, record):  # pragma: no cover - sqlite setup
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    User.__table__.create(bind=engine)
    BrainDump.__table__.create(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    return override_get_db


@pytest.mark.skipif("OPIK_API_KEY" not in os.environ, reason="OPIK_API_KEY env var required for Opik tests")
def test_app_runs_with_opik_enabled(monkeypatch, sqlite_override):
    api_key = os.environ["OPIK_API_KEY"]
    monkeypatch.setenv("OPIK_ENABLED", "true")
    monkeypatch.setenv("OPIK_PROJECT", "flowbuddy-test")
    monkeypatch.setenv("OPIK_API_KEY", api_key)

    import app.core.config as config_module
    import app.main as main_module

    importlib.reload(config_module)
    importlib.reload(client_module)
    monkeypatch.setattr(client_module, "Opik", _DummyOpik)
    client_module._client = None
    client_module._init_attempted = False
    reloaded_main = importlib.reload(main_module)

    override = sqlite_override
    reloaded_main.app.dependency_overrides[get_db] = override

    with TestClient(reloaded_main.app) as test_client:
        assert test_client.get("/health").status_code == 200
        resp = test_client.post(
            "/brain-dump",
            json={
                "user_id": str(uuid4()),
                "text": "Testing opik path with some blockers because project stuck.",
            },
        )
        assert resp.status_code == 200

    reloaded_main.app.dependency_overrides.clear()

    monkeypatch.setenv("OPIK_ENABLED", "false")
    importlib.reload(config_module)
    importlib.reload(client_module)
    client_module._client = None
    client_module._init_attempted = False
    importlib.reload(main_module)
