from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.deps import get_db
from app.db.models.brain_dump import BrainDump
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
    BrainDump.__table__.create(bind=engine)

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


def test_brain_dump_auto_creates_user_and_persists(client):
    test_client, session_factory = client
    payload = {
        "user_id": str(uuid4()),
        "text": "I'm feeling overwhelmed because my project resolution is stuck. I want to focus tomorrow.",
    }

    response = test_client.post("/brain-dump", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["id"]
    assert data["signals"]["blockers"]

    with session_factory() as db:
        dumps = db.query(BrainDump).all()
        users = db.query(User).all()
        assert len(dumps) == 1
        assert len(users) == 1
        assert dumps[0].user_id == users[0].id


def test_brain_dump_repeated_calls_share_user(client):
    test_client, session_factory = client
    user_id = str(uuid4())
    payload = {"user_id": user_id, "text": "First note"}
    payload2 = {"user_id": user_id, "text": "Second note"}

    assert test_client.post("/brain-dump", json=payload).status_code == 200
    assert test_client.post("/brain-dump", json=payload2).status_code == 200

    with session_factory() as db:
        assert db.query(User).count() == 1
        assert db.query(BrainDump).count() == 2


def test_brain_dump_missing_user_id_returns_422(client):
    test_client, _ = client
    response = test_client.post("/brain-dump", json={"text": "hi"})
    assert response.status_code == 422


def test_brain_dump_empty_text_rejected(client):
    test_client, _ = client
    payload = {"user_id": str(uuid4()), "text": "   "}
    response = test_client.post("/brain-dump", json=payload)
    assert response.status_code == 422


def test_brain_dump_too_long_rejected(client):
    test_client, _ = client
    payload = {"user_id": str(uuid4()), "text": "a" * 2001}
    response = test_client.post("/brain-dump", json=payload)
    assert response.status_code == 422


def test_brain_dump_request_id_echoed(client):
    test_client, _ = client
    req_id = "req-123"
    payload = {"user_id": str(uuid4()), "text": "hello"}
    response = test_client.post("/brain-dump", headers={"X-Request-Id": req_id}, json=payload)
    assert response.status_code == 200
    assert response.headers.get("X-Request-Id") == req_id


def test_brain_dump_extractor_failure_falls_back(client, monkeypatch):
    test_client, session_factory = client
    payload = {"user_id": str(uuid4()), "text": "hello there"}

    def boom(_text: str):
        raise RuntimeError("extractor offline")

    import app.api.routes.brain_dump as brain_dump_route

    monkeypatch.setattr(brain_dump_route, "extract_signals", boom)

    response = test_client.post("/brain-dump", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["signals"]["blockers"] == []
    assert data["acknowledgement"]

    with session_factory() as db:
        dump = db.query(BrainDump).one()
        assert dump.signals_extracted["blockers"] == []
