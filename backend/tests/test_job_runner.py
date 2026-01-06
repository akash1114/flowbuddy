from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models.agent_action_log import AgentActionLog
from app.db.models.resolution import Resolution
from app.db.models.task import Task
from app.db.models.user import User
from app.services.job_runner import (
    run_interventions_for_all_users,
    run_interventions_for_user,
    run_weekly_plan_for_all_users,
    run_weekly_plan_for_user,
)


def _session():
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

    TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    User.__table__.create(bind=engine)
    Resolution.__table__.create(bind=engine)
    Task.__table__.create(bind=engine)
    AgentActionLog.__table__.create(bind=engine)
    return TestingSession


def _seed_user(db_session):
    session = db_session()
    try:
        user_id = uuid4()
        session.add(User(id=user_id))
        session.commit()
        return user_id
    finally:
        session.close()


def _seed_resolution(db_session, user_id, status="active"):
    session = db_session()
    try:
        res = Resolution(
            user_id=user_id,
            title="Focus",
            type="habit",
            duration_weeks=8,
            status=status,
        )
        session.add(res)
        session.commit()
        session.refresh(res)
        return res
    finally:
        session.close()


def _seed_task(db_session, **kwargs):
    session = db_session()
    try:
        task = Task(**kwargs)
        session.add(task)
        session.commit()
        return task
    finally:
        session.close()


def test_weekly_plan_job_runner_dedup():
    Session = _session()
    user_id = _seed_user(Session)
    res = _seed_resolution(Session, user_id)
    today = date.today()
    _seed_task(
        Session,
        user_id=user_id,
        resolution_id=res.id,
        title="Task",
        scheduled_day=today - timedelta(days=1),
        metadata_json={"draft": False},
        completed=True,
        completed_at=datetime.now(timezone.utc),
    )

    session = Session()
    first = run_weekly_plan_for_all_users(session)
    assert first.users_processed == 1
    assert first.snapshots_written == 1
    second = run_weekly_plan_for_all_users(session)
    assert second.snapshots_written == 0
    created = run_weekly_plan_for_user(session, user_id, force=True)
    assert created is True

    logs = session.query(AgentActionLog).filter(AgentActionLog.action_type == "weekly_plan_generated").all()
    assert len(logs) == 2
    assert logs[0].action_payload.get("week_start")
    session.close()


def test_intervention_job_runner_counts():
    Session = _session()
    user_id = _seed_user(Session)
    res = _seed_resolution(Session, user_id)
    today = date.today()
    for idx in range(2):
        _seed_task(
            Session,
            user_id=user_id,
            resolution_id=res.id,
            title=f"T{idx}",
            scheduled_day=today - timedelta(days=idx + 1),
            metadata_json={"draft": False},
            completed=False,
        )

    session = Session()
    result = run_interventions_for_all_users(session)
    assert result.users_processed == 1
    assert result.snapshots_written == 1
    result2 = run_interventions_for_all_users(session)
    assert result2.snapshots_written == 0
    assert run_interventions_for_user(session, user_id, force=True) is True
    logs = session.query(AgentActionLog).filter(AgentActionLog.action_type == "intervention_generated").all()
    assert len(logs) == 2
    session.close()
