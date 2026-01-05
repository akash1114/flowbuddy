from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.deps import get_db
from app.db.models.agent_action_log import AgentActionLog
from app.db.models.resolution import Resolution
from app.db.models.task import Task
from app.db.models.user import User
from app.main import app


@pytest.fixture()
def client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):  # pragma: no cover - sqlite setup
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    User.__table__.create(bind=engine)
    Resolution.__table__.create(bind=engine)
    Task.__table__.create(bind=engine)
    AgentActionLog.__table__.create(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client, TestingSessionLocal
    app.dependency_overrides.clear()


def _create_resolution(client: TestClient, user_id: UUID) -> UUID:
    response = client.post(
        "/resolutions",
        json={"user_id": str(user_id), "text": "Build flow", "duration_weeks": 8},
    )
    assert response.status_code == 201
    return UUID(response.json()["id"])


def _decompose_and_approve(client: TestClient, user_id: UUID) -> dict:
    resolution_id = _create_resolution(client, user_id)
    assert client.post(f"/resolutions/{resolution_id}/decompose").status_code == 200
    approve_resp = client.post(
        f"/resolutions/{resolution_id}/approve",
        json={"user_id": str(user_id), "decision": "accept"},
    )
    assert approve_resp.status_code == 200
    return {"resolution_id": resolution_id, "tasks": approve_resp.json()["tasks_activated"]}


def test_dashboard_returns_active_resolution_summary(client):
    test_client, session_factory = client
    user_id = uuid4()
    plan = _decompose_and_approve(test_client, user_id)

    active_task_id = plan["tasks"][0]["id"]

    # Complete a task and add a note to another
    assert (
        test_client.patch(f"/tasks/{active_task_id}", json={"user_id": str(user_id), "completed": True}).status_code
        == 200
    )
    assert (
        test_client.patch(f"/tasks/{active_task_id}/note", json={"user_id": str(user_id), "note": "Felt grounded"}).status_code
        == 200
    )

    resp = test_client.get("/dashboard", params={"user_id": str(user_id)})
    assert resp.status_code == 200
    dashboard = resp.json()
    assert dashboard["user_id"] == str(user_id)
    assert dashboard["active_resolutions"]

    entry = dashboard["active_resolutions"][0]
    assert entry["tasks"]["total"] >= len(plan["tasks"])
    assert entry["tasks"]["completed"] >= 1
    assert entry["completion_rate"] >= 0
    assert entry["recent_activity"]
    assert any(activity["note_present"] for activity in entry["recent_activity"])


def test_dashboard_returns_empty_when_no_active_resolutions(client):
    test_client, _ = client
    user_id = uuid4()

    resp = test_client.get("/dashboard", params={"user_id": str(user_id)})
    assert resp.status_code == 200
    data = resp.json()
    assert data["active_resolutions"] == []


def test_dashboard_invalid_user_id(client):
    test_client, _ = client
    resp = test_client.get("/dashboard", params={"user_id": "not-a-uuid"})
    assert resp.status_code == 422
