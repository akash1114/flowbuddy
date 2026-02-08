from __future__ import annotations

from datetime import date, datetime, timezone, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.deps import get_db
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
    def set_fk(conn, record):  # pragma: no cover
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    User.__table__.create(bind=engine)
    Resolution.__table__.create(bind=engine)
    Task.__table__.create(bind=engine)
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


def _seed_user(session_factory):
    session = session_factory()
    try:
        user_id = uuid4()
        session.add(User(id=user_id))
        session.commit()
        return user_id
    finally:
        session.close()


def _seed_resolution(session_factory, user_id):
    session = session_factory()
    try:
        res = Resolution(
            user_id=user_id,
            title="Mindful mornings",
            type="habit",
            duration_weeks=8,
            status="active",
        )
        session.add(res)
        session.commit()
        session.refresh(res)
        return res
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


def test_weekly_plan_preview_with_data(client):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)
    resolution = _seed_resolution(session_factory, user_id)

    today = date.today()
    _seed_task(
        session_factory,
        user_id=user_id,
        resolution_id=resolution.id,
        title="Breathing",
        scheduled_day=today - timedelta(days=1),
        duration_min=10,
        metadata_json={"draft": False},
        completed=True,
        completed_at=datetime.now(timezone.utc),
    )
    _seed_task(
        session_factory,
        user_id=user_id,
        resolution_id=resolution.id,
        title="Stretch",
        scheduled_day=today - timedelta(days=2),
        duration_min=15,
        metadata_json={"draft": False, "note": "Prefer mornings"},
        completed=False,
    )
    _seed_task(
        session_factory,
        user_id=user_id,
        resolution_id=resolution.id,
        title="Journal",
        scheduled_day=today - timedelta(days=3),
        duration_min=10,
        metadata_json={"draft": False},
        completed=False,
    )

    resp = test_client.get("/weekly-plan/preview", params={"user_id": str(user_id)})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["inputs"]["active_resolutions"] == 1
    assert payload["inputs"]["active_tasks_total"] == 3
    # completion approx 0.33
    assert abs(payload["inputs"]["completion_rate"] - 0.33) < 0.01 or payload["inputs"]["completion_rate"] in (0.33, 0.34)
    assert payload["inputs"]["primary_focus_resolution_id"] == str(resolution.id)
    assert len(payload["inputs"]["resolution_stats"]) == 1
    assert payload["inputs"]["resolution_stats"][0]["resolution_id"] == str(resolution.id)
    assert payload["micro_resolution"]["title"]
    assert payload["micro_resolution"]["suggested_week_1_tasks"]


def test_weekly_plan_preview_handles_empty_user(client):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)

    resp = test_client.get("/weekly-plan/preview", params={"user_id": str(user_id)})
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["inputs"]["active_resolutions"] == 0
    assert payload["inputs"]["completion_rate"] == 0
    assert payload["inputs"]["resolution_stats"] == []
    assert payload["inputs"]["primary_focus_resolution_id"] is None
    assert payload["micro_resolution"]["title"]
