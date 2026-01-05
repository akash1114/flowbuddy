from __future__ import annotations

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
        json={"user_id": str(user_id), "text": "Build a mindful routine", "duration_weeks": 6},
    )
    assert response.status_code == 201
    return UUID(response.json()["id"])


def _create_draft_tasks(client: TestClient, user_id: UUID) -> UUID:
    resolution_id = _create_resolution(client, user_id)
    decompose_resp = client.post(f"/resolutions/{resolution_id}/decompose")
    assert decompose_resp.status_code == 200
    return resolution_id


def _approve_plan(client: TestClient, user_id: UUID) -> dict:
    resolution_id = _create_draft_tasks(client, user_id)
    approve_resp = client.post(
        f"/resolutions/{resolution_id}/approve",
        json={"user_id": str(user_id), "decision": "accept"},
    )
    assert approve_resp.status_code == 200
    return {"resolution_id": resolution_id, "tasks": approve_resp.json()["tasks_activated"]}


def test_list_active_tasks_after_approval(client):
    test_client, _ = client
    user_id = uuid4()
    plan = _approve_plan(test_client, user_id)

    resp = test_client.get("/tasks", params={"user_id": str(user_id)})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == len(plan["tasks"])
    assert all(task["completed"] is False for task in data)


def test_list_draft_tasks_before_approval(client):
    test_client, _ = client
    user_id = uuid4()
    _create_draft_tasks(test_client, user_id)

    resp = test_client.get("/tasks", params={"user_id": str(user_id), "status": "draft"})
    assert resp.status_code == 200
    data = resp.json()
    assert data  # draft tasks should exist


def test_update_task_completion_creates_logs(client):
    test_client, session_factory = client
    user_id = uuid4()
    plan = _approve_plan(test_client, user_id)
    task_id = plan["tasks"][0]["id"]

    complete_resp = test_client.patch(
        f"/tasks/{task_id}",
        json={"user_id": str(user_id), "completed": True},
    )
    assert complete_resp.status_code == 200
    body = complete_resp.json()
    assert body["completed"] is True
    assert body["completed_at"]

    with session_factory() as db:
        task = db.get(Task, UUID(task_id))
        assert task.completed is True
        assert task.completed_at is not None
        all_logs = db.query(AgentActionLog).filter(AgentActionLog.user_id == user_id).all()
        task_logs = [log for log in all_logs if log.action_type.startswith("task_")]
        assert len(task_logs) == 1
        assert task_logs[0].action_type == "task_completed"

    # Idempotent toggle
    repeat_resp = test_client.patch(
        f"/tasks/{task_id}",
        json={"user_id": str(user_id), "completed": True},
    )
    assert repeat_resp.status_code == 200
    with session_factory() as db:
        task_logs = [
            log
            for log in db.query(AgentActionLog).filter(AgentActionLog.user_id == user_id).all()
            if log.action_type.startswith("task_")
        ]
        assert len(task_logs) == 1  # no new log

    # Uncomplete
    uncomplete_resp = test_client.patch(
        f"/tasks/{task_id}",
        json={"user_id": str(user_id), "completed": False},
    )
    assert uncomplete_resp.status_code == 200
    uncomplete_body = uncomplete_resp.json()
    assert uncomplete_body["completed"] is False
    assert uncomplete_body["completed_at"] is None
    with session_factory() as db:
        task = db.get(Task, UUID(task_id))
        assert task.completed is False
        assert task.completed_at is None
        task_logs = [
            log
            for log in db.query(AgentActionLog)
            .filter(AgentActionLog.user_id == user_id)
            .order_by(AgentActionLog.created_at)
            .all()
            if log.action_type.startswith("task_")
        ]
        assert len(task_logs) == 2
        assert task_logs[-1].action_type == "task_uncompleted"


def test_update_task_enforces_ownership(client):
    test_client, _ = client
    user_a = uuid4()
    plan = _approve_plan(test_client, user_a)

    resp = test_client.patch(
        f"/tasks/{plan['tasks'][0]['id']}",
        json={"user_id": str(uuid4()), "completed": True},
    )
    assert resp.status_code == 403


def test_task_note_updates_and_audit_logs(client):
    test_client, session_factory = client
    user_id = uuid4()
    plan = _approve_plan(test_client, user_id)
    task_id = plan["tasks"][0]["id"]

    note_resp = test_client.patch(
        f"/tasks/{task_id}/note",
        json={"user_id": str(user_id), "note": "Focus on breathing"},
    )
    assert note_resp.status_code == 200
    assert note_resp.json()["note"] == "Focus on breathing"

    with session_factory() as db:
        task = db.get(Task, UUID(task_id))
        assert (task.metadata_json or {}).get("note") == "Focus on breathing"
        logs = [
            log
            for log in db.query(AgentActionLog).filter(AgentActionLog.user_id == user_id).all()
            if log.action_type.startswith("task_note")
        ]
        assert len(logs) == 1
        assert logs[0].action_type == "task_note_updated"

    # Idempotent update (same note)
    repeat_resp = test_client.patch(
        f"/tasks/{task_id}/note",
        json={"user_id": str(user_id), "note": "Focus on breathing"},
    )
    assert repeat_resp.status_code == 200
    with session_factory() as db:
        logs = [
            log
            for log in db.query(AgentActionLog).filter(AgentActionLog.user_id == user_id).all()
            if log.action_type.startswith("task_note")
        ]
        assert len(logs) == 1

    # Clear note
    clear_resp = test_client.patch(
        f"/tasks/{task_id}/note",
        json={"user_id": str(user_id), "note": None},
    )
    assert clear_resp.status_code == 200
    assert clear_resp.json()["note"] is None
    with session_factory() as db:
        task = db.get(Task, UUID(task_id))
        assert (task.metadata_json or {}).get("note") is None
        logs = [
            log
            for log in db.query(AgentActionLog).filter(AgentActionLog.user_id == user_id).all()
            if log.action_type.startswith("task_note")
        ]
        assert len(logs) == 2
        assert logs[-1].action_type == "task_note_cleared"

    # Too long note
    long_note = "a" * 501
    resp = test_client.patch(
        f"/tasks/{task_id}/note",
        json={"user_id": str(user_id), "note": long_note},
    )
    assert resp.status_code == 422

    # Ownership
    resp = test_client.patch(
        f"/tasks/{task_id}/note",
        json={"user_id": str(uuid4()), "note": "hi"},
    )
    assert resp.status_code == 403
