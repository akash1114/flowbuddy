from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.deps import get_db
from app.db.models.task import Task
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
    def set_fk(conn, record):  # pragma: no cover
        cursor = conn.cursor()
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


def _seed_user(session_factory):
    session = session_factory()
    try:
        user_id = uuid4()
        session.add(User(id=user_id))
        session.commit()
        return user_id
    finally:
        session.close()


def _seed_task(session_factory, **kwargs):
    session = session_factory()
    try:
        task = Task(**kwargs)
        session.add(task)
        session.commit()
        return task
    finally:
        session.close()


def test_intervention_flagged_for_slippage(client):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)
    today = date.today()
    for idx in range(3):
        _seed_task(
            session_factory,
            user_id=user_id,
            title=f"Task {idx}",
            scheduled_day=today - timedelta(days=idx + 1),
            metadata_json={"draft": False},
            completed=False,
        )

    resp = test_client.get("/interventions/preview", params={"user_id": str(user_id)})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["slippage"]["flagged"] is True
    assert payload["card"] is not None
    assert payload["card"]["options"]


def test_intervention_not_flagged_when_on_track(client):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)
    today = date.today()
    for idx in range(3):
        _seed_task(
            session_factory,
            user_id=user_id,
            title=f"Task {idx}",
            scheduled_day=today - timedelta(days=idx + 1),
            metadata_json={"draft": False},
            completed=True,
            completed_at=datetime.now(timezone.utc),
        )

    resp = test_client.get("/interventions/preview", params={"user_id": str(user_id)})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["slippage"]["flagged"] is False
    assert payload["card"] is None
    assert payload["slippage"]["reason"] == "Looks on track. Keep the gentle cadence."
