from __future__ import annotations

from datetime import date, timedelta
from uuid import uuid4

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
    def set_fk(conn, record):  # pragma: no cover
        cursor = conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    User.__table__.create(bind=engine)
    Resolution.__table__.create(bind=engine)
    Task.__table__.create(bind=engine)
    UserPreferences.__table__.create(bind=engine)
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


def test_intervention_run_and_latest(client):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)
    resolution = _seed_resolution(session_factory, user_id)
    today = date.today()
    for idx in range(3):
        _seed_task(
            session_factory,
            user_id=user_id,
            resolution_id=resolution.id,
            title=f"T{idx}",
            scheduled_day=today - timedelta(days=idx + 1),
            metadata_json={"draft": False},
            completed=False,
        )

    run_resp = test_client.post("/interventions/run", json={"user_id": str(user_id)})
    assert run_resp.status_code == 200
    assert run_resp.json()["slippage"]["flagged"] is True

    latest_resp = test_client.get("/interventions/latest", params={"user_id": str(user_id)})
    assert latest_resp.status_code == 200
    assert latest_resp.json()["card"]["options"][0]["key"] == "reduce_scope"

    session = session_factory()
    try:
        logs = (
            session.query(AgentActionLog)
            .filter(AgentActionLog.user_id == user_id, AgentActionLog.action_type == "intervention_generated")
            .all()
        )
        assert len(logs) == 1
        assert logs[0].action_payload["slippage"]["flagged"] is True
    finally:
        session.close()

    # dedupe guard
    second_run = test_client.post("/interventions/run", json={"user_id": str(user_id)})
    assert second_run.status_code == 200
    session = session_factory()
    try:
        count = (
            session.query(AgentActionLog)
            .filter(AgentActionLog.user_id == user_id, AgentActionLog.action_type == "intervention_generated")
            .count()
        )
        assert count == 1
    finally:
        session.close()

    forced_run = test_client.post("/interventions/run", json={"user_id": str(user_id), "force": True})
    assert forced_run.status_code == 200
    session = session_factory()
    try:
        count = (
            session.query(AgentActionLog)
            .filter(AgentActionLog.user_id == user_id, AgentActionLog.action_type == "intervention_generated")
            .count()
        )
        assert count == 2
    finally:
        session.close()


def test_intervention_latest_404_when_missing(client):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)

    resp = test_client.get("/interventions/latest", params={"user_id": str(user_id)})
    assert resp.status_code == 404
