from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.deps import get_db
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


def _create_resolution_via_api(test_client: TestClient, *, duration: int | None = 8) -> UUID:
    user_id = uuid4()
    payload = {
        "user_id": str(user_id),
        "text": "Build a mindful morning routine to support focus.",
        "duration_weeks": duration,
    }
    response = test_client.post("/resolutions", json=payload)
    assert response.status_code == 201
    data = response.json()
    return UUID(data["id"])


def test_decomposition_creates_plan_and_draft_tasks(client):
    test_client, session_factory = client
    resolution_id = _create_resolution_via_api(test_client, duration=6)

    response = test_client.post(f"/resolutions/{resolution_id}/decompose")
    assert response.status_code == 200
    payload = response.json()
    assert payload["plan"]["weeks"] == 6
    assert 2 <= len(payload["week_1_tasks"]) <= 4
    assert all(task["draft"] for task in payload["week_1_tasks"])

    with session_factory() as db:
        resolution = db.get(Resolution, resolution_id)
        assert "plan_v1" in (resolution.metadata_json or {})
        tasks = db.query(Task).filter(Task.resolution_id == resolution_id).all()
        assert len(tasks) == len(payload["week_1_tasks"])
        assert all(task.metadata_json.get("draft") for task in tasks)


def test_decomposition_is_idempotent_without_regeneration(client):
    test_client, session_factory = client
    resolution_id = _create_resolution_via_api(test_client)

    first = test_client.post(f"/resolutions/{resolution_id}/decompose")
    second = test_client.post(f"/resolutions/{resolution_id}/decompose")
    assert first.status_code == second.status_code == 200

    ids_first = {task["id"] for task in first.json()["week_1_tasks"]}
    ids_second = {task["id"] for task in second.json()["week_1_tasks"]}
    assert ids_first == ids_second


def test_decomposition_regenerate_replaces_draft_tasks(client):
    test_client, session_factory = client
    resolution_id = _create_resolution_via_api(test_client)

    baseline = test_client.post(f"/resolutions/{resolution_id}/decompose").json()
    regen_payload = test_client.post(
        f"/resolutions/{resolution_id}/decompose",
        json={"regenerate": True, "weeks": 5},
    ).json()

    ids_baseline = {task["id"] for task in baseline["week_1_tasks"]}
    ids_regen = {task["id"] for task in regen_payload["week_1_tasks"]}
    assert ids_baseline != ids_regen
    assert regen_payload["plan"]["weeks"] == 5

    with session_factory() as db:
        tasks = db.query(Task).filter(Task.resolution_id == resolution_id).all()
        assert len(tasks) == len(ids_regen)
        assert all(task.metadata_json.get("draft") for task in tasks)


def test_decomposition_missing_resolution_returns_404(client):
    test_client, _ = client
    response = test_client.post(f"/resolutions/{uuid4()}/decompose")
    assert response.status_code == 404


def test_decomposition_handles_disabled_observability(monkeypatch, client):
    test_client, session_factory = client
    resolution_id = _create_resolution_via_api(test_client)

    import app.observability.client as opik_client

    monkeypatch.setattr(opik_client, "get_opik_client", lambda: None)

    response = test_client.post(f"/resolutions/{resolution_id}/decompose", json={"weeks": 4})
    assert response.status_code == 200
