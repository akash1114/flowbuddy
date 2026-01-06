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
from app.db.models.user_preferences import UserPreferences
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
    UserPreferences.__table__.create(bind=engine)

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


def _approve_plan(client: TestClient, user_id: UUID) -> list[str]:
    resolution_id = _create_resolution(client, user_id)
    decomposition = client.post(f"/resolutions/{resolution_id}/decompose")
    assert decomposition.status_code == 200

    approve_resp = client.post(
        f"/resolutions/{resolution_id}/approve",
        json={"user_id": str(user_id), "decision": "accept"},
    )
    assert approve_resp.status_code == 200
    tasks = approve_resp.json()["tasks_activated"]
    return [task["id"] for task in tasks]


def _seed_agent_actions(client: TestClient, user_id: UUID) -> None:
    task_ids = _approve_plan(client, user_id)
    task_id = task_ids[0]

    complete_resp = client.patch(
        f"/tasks/{task_id}",
        json={"user_id": str(user_id), "completed": True},
    )
    assert complete_resp.status_code == 200
    uncomplete_resp = client.patch(
        f"/tasks/{task_id}",
        json={"user_id": str(user_id), "completed": False},
    )
    assert uncomplete_resp.status_code == 200

    note_resp = client.patch(
        f"/tasks/{task_id}/note",
        json={"user_id": str(user_id), "note": "Focus on breathing"},
    )
    assert note_resp.status_code == 200
    clear_resp = client.patch(
        f"/tasks/{task_id}/note",
        json={"user_id": str(user_id), "note": ""},
    )
    assert clear_resp.status_code == 200

    prefs_resp = client.patch(
        "/preferences",
        json={"user_id": str(user_id), "coaching_paused": True},
    )
    assert prefs_resp.status_code == 200

    weekly_resp = client.post("/weekly-plan/run", json={"user_id": str(user_id), "force": True})
    assert weekly_resp.status_code == 200
    intervention_resp = client.post("/interventions/run", json={"user_id": str(user_id), "force": True})
    assert intervention_resp.status_code == 200


def test_agent_log_list_and_detail_endpoints(client):
    test_client, _ = client
    user_id = uuid4()
    _seed_agent_actions(test_client, user_id)

    list_resp = test_client.get("/agent-log", params={"user_id": str(user_id), "limit": 5})
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert list_data["request_id"]
    assert list_data["next_cursor"] is not None
    assert len(list_data["items"]) == 5

    first_item = list_data["items"][0]
    assert first_item["summary"]
    assert "request_id" in first_item

    detail_resp = test_client.get(f"/agent-log/{first_item['id']}", params={"user_id": str(user_id)})
    assert detail_resp.status_code == 200
    detail_data = detail_resp.json()
    assert detail_data["payload"]
    assert detail_data["summary"]
    assert detail_data["request_id_header"]

    other_user = uuid4()
    forbidden = test_client.get(f"/agent-log/{first_item['id']}", params={"user_id": str(other_user)})
    assert forbidden.status_code == 403

    filter_resp = test_client.get(
        "/agent-log",
        params={"user_id": str(user_id), "action_type": "task_completed"},
    )
    assert filter_resp.status_code == 200
    filter_data = filter_resp.json()
    assert all(item["action_type"] == "task_completed" for item in filter_data["items"])
