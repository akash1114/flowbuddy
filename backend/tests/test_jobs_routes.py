from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.deps import get_db
from app.db.models.agent_action_log import AgentActionLog
from app.db.models.resolution import Resolution
from app.db.models.task import Task
from app.db.models.user import User
from app.main import app


@pytest.fixture()
def client(monkeypatch):
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
    AgentActionLog.__table__.create(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "debug", True)
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
        res = Resolution(user_id=user_id, title="Focus", type="habit", duration_weeks=8, status="active")
        session.add(res)
        session.commit()
        session.refresh(res)
        return res.id
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


def test_jobs_config_and_run_now(client):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)
    res_id = _seed_resolution(session_factory, user_id)
    _seed_task(
        session_factory,
        user_id=user_id,
        resolution_id=res_id,
        title="Task",
        scheduled_day=date.today() - timedelta(days=1),
        metadata_json={"draft": False},
        completed=False,
    )

    resp = test_client.get("/jobs")
    assert resp.status_code == 200
    assert "scheduler_enabled" in resp.json()

    run_resp = test_client.post(
        "/jobs/run-now",
        json={"job": "weekly_plan", "force": True},
    )
    assert run_resp.status_code == 200
    data = run_resp.json()
    assert data["users_processed"] >= 1
    assert data["request_id"]


def test_jobs_run_now_forbidden_in_prod(monkeypatch):
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
    AgentActionLog.__table__.create(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "debug", False)
    with TestClient(app) as test_client:
        resp = test_client.post("/jobs/run-now", json={"job": "weekly_plan"})
        assert resp.status_code == 403
    app.dependency_overrides.clear()
