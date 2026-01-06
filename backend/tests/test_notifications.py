from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
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
from app.db.models.user_preferences import UserPreferences
from app.main import app
from app.services.notifications.hooks import notify_intervention_snapshot
from app.services.notifications.base import NotificationResult


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
    UserPreferences.__table__.create(bind=engine)
    AgentActionLog.__table__.create(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    monkeypatch.setattr(settings, "notifications_enabled", True)
    monkeypatch.setattr(settings, "notifications_provider", "noop")
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


def test_weekly_plan_notification_recorded(client):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)
    res = _seed_resolution(session_factory, user_id)
    _seed_task(
        session_factory,
        user_id=user_id,
        resolution_id=res.id,
        title="Task",
        scheduled_day=date.today() - timedelta(days=1),
        metadata_json={"draft": False},
        completed=False,
    )
    resp = test_client.post("/weekly-plan/run", json={"user_id": str(user_id), "force": True})
    assert resp.status_code == 200

    session = session_factory()
    logs = session.query(AgentActionLog).filter(AgentActionLog.user_id == user_id).all()
    session.close()
    assert any(log.action_type == "notification_weekly_plan" for log in logs)


def test_notification_skipped_when_paused(client, monkeypatch):
    monkeypatch.setattr(settings, "notifications_enabled", True)
    test_client, session_factory = client
    user_id = _seed_user(session_factory)
    res = _seed_resolution(session_factory, user_id)
    _seed_task(
        session_factory,
        user_id=user_id,
        resolution_id=res.id,
        title="Task",
        scheduled_day=date.today(),
        metadata_json={"draft": False},
        completed=False,
    )
    session = session_factory()
    session.add(UserPreferences(user_id=user_id, coaching_paused=True))
    session.commit()
    session.close()

    resp = test_client.post("/weekly-plan/run", json={"user_id": str(user_id), "force": True})
    assert resp.status_code == 200

    session = session_factory()
    notif = (
        session.query(AgentActionLog)
        .filter(AgentActionLog.action_type == "notification_weekly_plan")
        .order_by(AgentActionLog.created_at.desc())
        .first()
    )
    session.close()
    assert notif
    assert notif.action_payload["result"]["status"] == "skipped"


def test_intervention_notification_only_when_flagged(client, monkeypatch):
    test_client, session_factory = client
    user_id = _seed_user(session_factory)
    res = _seed_resolution(session_factory, user_id)
    today = date.today()
    for idx in range(3):
        _seed_task(
            session_factory,
            user_id=user_id,
            resolution_id=res.id,
            title=f"T{idx}",
            scheduled_day=today - timedelta(days=idx + 1),
            metadata_json={"draft": False},
            completed=False,
        )

    resp = test_client.post("/interventions/run", json={"user_id": str(user_id), "force": True})
    assert resp.status_code == 200
    session = session_factory()
    notif = (
        session.query(AgentActionLog)
        .filter(AgentActionLog.action_type == "notification_intervention")
        .order_by(AgentActionLog.created_at.desc())
        .first()
    )
    session.close()
    assert notif
    assert notif.action_payload["result"]["status"] == "noop"

    session = session_factory()
    fake_snapshot = AgentActionLog(
        user_id=user_id,
        action_type="intervention_generated",
        action_payload={
            "week_start": today.isoformat(),
            "week_end": (today + timedelta(days=7)).isoformat(),
            "slippage": {"flagged": False, "reason": None, "completion_rate": 1.0, "missed_scheduled": 0},
            "request_id": "",
        },
    )
    session.add(fake_snapshot)
    session.commit()
    session.refresh(fake_snapshot)

    called = {"value": False}

    class DummyService:
        def notify_weekly_plan_ready(self, **kwargs):  # pragma: no cover - not used
            called["value"] = True
            return NotificationResult(status="noop", reason="dummy")

        def notify_intervention_ready(self, **kwargs):
            called["value"] = True
            return NotificationResult(status="noop", reason="dummy")

    monkeypatch.setattr("app.services.notifications.hooks.get_notification_service", lambda: DummyService())
    notify_intervention_snapshot(session, fake_snapshot, None)
    notif_logs = (
        session.query(AgentActionLog)
        .filter(AgentActionLog.action_type == "notification_intervention")
        .all()
    )
    matching = next(
        log for log in notif_logs if log.action_payload.get("snapshot_log_id") == str(fake_snapshot.id)
    )
    session.close()
    assert matching.action_payload["result"]["status"] == "skipped"
    assert called["value"] is False
