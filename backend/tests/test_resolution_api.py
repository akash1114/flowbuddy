from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.deps import get_db
from app.db.models.resolution import Resolution
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


def test_resolution_intake_persists_and_returns_payload(client):
    test_client, session_factory = client
    user_id = str(uuid4())
    payload = {
        "user_id": user_id,
        "text": "Build a mindful morning routine for better focus.",
        "duration_weeks": 6,
    }

    response = test_client.post("/resolutions", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["user_id"] == user_id
    assert data["title"] == "Build a mindful morning routine for better focus"
    assert data["raw_text"] == payload["text"]
    assert data["type"] in {"habit", "health"}
    assert data["duration_weeks"] == 6
    assert data["status"] == "draft"
    assert data["request_id"]

    with session_factory() as db:
        resolutions = db.query(Resolution).all()
        users = db.query(User).all()
        assert len(resolutions) == 1
        assert len(users) == 1
        assert resolutions[0].metadata_json["raw_text"] == payload["text"]
        assert resolutions[0].user_id == users[0].id


def test_resolution_intake_rejects_short_text(client):
    test_client, _ = client
    payload = {"user_id": str(uuid4()), "text": "hi  ", "duration_weeks": 4}
    response = test_client.post("/resolutions", json=payload)
    assert response.status_code == 422


def test_resolution_intake_duration_bounds_enforced(client):
    test_client, _ = client
    payload = {"user_id": str(uuid4()), "text": "Learn guitar basics over time", "duration_weeks": 0}
    assert test_client.post("/resolutions", json=payload).status_code == 422

    payload["duration_weeks"] = 53
    assert test_client.post("/resolutions", json=payload).status_code == 422


def test_resolution_request_id_echoed(client):
    test_client, _ = client
    req_id = "req-resolution-1"
    payload = {"user_id": str(uuid4()), "text": "Save $500 for an emergency fund."}
    response = test_client.post("/resolutions", headers={"X-Request-Id": req_id}, json=payload)
    assert response.status_code == 201
    assert response.headers.get("X-Request-Id") == req_id
