from __future__ import annotations

import json
from pathlib import Path
from typing import List, Dict, Any
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.deps import get_db
from datetime import date, timedelta

from app.db.models.user import User
from app.db.models.resolution import Resolution
from app.db.models.task import Task
from app.db.models.user_preferences import UserPreferences
from app.db.models.agent_action_log import AgentActionLog
from app.main import app

FIXTURE_PATH = Path(__file__).parent / "data" / "opik_regression_fixtures.json"


@pytest.fixture(scope="module")
def db_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )

    @event.listens_for(engine, "connect")
    def set_fk(dbapi_connection, connection_record):  # pragma: no cover - sqlite setup
        cursor = dbapi_connection.cursor()
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
    with TestClient(app) as client:
        yield client, TestingSessionLocal
    app.dependency_overrides.clear()


def _load_fixtures() -> Dict[str, Any]:
    with FIXTURE_PATH.open() as fh:
        return json.load(fh)


def _create_user(session_factory, availability_profile=None):
    session = session_factory()
    try:
        user_id = uuid4()
        session.add(
            User(id=user_id, availability_profile=availability_profile),
        )
        session.add(UserPreferences(user_id=user_id))
        session.commit()
        return user_id
    finally:
        session.close()


def test_regression_decompositions(db_client):
    client, session_factory = db_client
    fixtures = _load_fixtures()

    for case in fixtures["decomposition_cases"]:
        user_id = _create_user(session_factory, availability_profile=case.get("availability_profile"))
        payload = {
            "user_id": str(user_id),
            "text": case["user_text"],
            "duration_weeks": case["duration_weeks"],
            "domain": case.get("domain", "personal"),
        }
        create_resp = client.post("/resolutions", json=payload)
        assert create_resp.status_code == 201
        resolution_id = create_resp.json()["id"]

        decompose_resp = client.post(f"/resolutions/{resolution_id}/decompose")
        assert decompose_resp.status_code == 200, f"Failed case {case['user_text']}"


def test_regression_weekly_plan(db_client):
    client, session_factory = db_client
    fixtures = _load_fixtures()

    for case in fixtures["weekly_plan_cases"]:
        user_id = _create_user(session_factory)
        session = session_factory()
        try:
            for idx, res_info in enumerate(case["active_resolutions"]):
                resolution = Resolution(
                    user_id=user_id,
                    title=res_info["title"],
                    type="habit",
                    status="active",
                )
                session.add(resolution)
                session.commit()
                session.refresh(resolution)
                # seed tasks based on stats
                total = case["stats"]["total_tasks"]
                completed = case["stats"]["completed_tasks"]
                for task_idx in range(total):
                    task = Task(
                        user_id=user_id,
                        resolution_id=resolution.id,
                        title=f"Synthetic task {idx}-{task_idx}",
                        metadata_json={"draft": False, "note": "; ".join(case["stats"].get("notes", []))},
                        scheduled_day=None,
                        completed=task_idx < completed,
                    )
                    session.add(task)
                session.commit()
        finally:
            session.close()

        run_resp = client.post("/weekly-plan/run", json={"user_id": str(user_id)})
        assert run_resp.status_code == 200, f"Weekly plan regression failed: {case['user_id_hint']}"


def test_regression_interventions(db_client):
    client, session_factory = db_client
    fixtures = _load_fixtures()

    for case in fixtures["intervention_cases"]:
        user_id = _create_user(session_factory)
        # seed tasks to simulate missed/completed counts
        session = session_factory()
        try:
            for idx in range(case["total"]):
                task = Task(
                    user_id=user_id,
                    resolution_id=None,
                    title=f"Intervention synthetic task {idx}",
                    metadata_json={"draft": False},
                    scheduled_day=date.today() - timedelta(days=idx + 1),
                    completed=idx < int(case["completion_rate"] * case["total"]),
                )
                session.add(task)
            session.commit()
        finally:
            session.close()

        resp = client.get("/interventions/preview", params={"user_id": str(user_id)})
        assert resp.status_code == 200, f"Intervention regression failed: {case['user_id_hint']}"
