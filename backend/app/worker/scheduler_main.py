"""Dedicated APScheduler worker process."""
from __future__ import annotations

import logging
import signal
import threading

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import settings
from app.core.logging import configure_logging
from app.db.session import SessionLocal
from app.services.job_runner import (
    run_interventions_for_all_users,
    run_weekly_plan_for_all_users,
)


logger = logging.getLogger(__name__)


def main() -> None:
    configure_logging(log_level=settings.log_level)
    logger.info("Scheduler worker starting (enabled=%s)", settings.scheduler_enabled)

    scheduler = BackgroundScheduler(timezone=settings.scheduler_timezone)

    if settings.scheduler_enabled:
        _register_jobs(scheduler)
        scheduler.start()
        if settings.jobs_run_on_startup:
            logger.info("Running jobs once on startup")
            _run_weekly_plan_job()
            _run_intervention_job()
    else:
        logger.warning("Scheduler disabled via config; worker will idle")

    stop_event = threading.Event()

    def shutdown(signum, frame):  # pragma: no cover - signal handler
        logger.info("Scheduler worker shutting down (signal=%s)", signum)
        if scheduler.running:
            scheduler.shutdown(wait=False)
        stop_event.set()

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    try:
        stop_event.wait()
    except KeyboardInterrupt:  # pragma: no cover - manual stop
        shutdown(signal.SIGINT, None)


def _register_jobs(scheduler: BackgroundScheduler) -> None:
    day_of_week = str(settings.weekly_job_day)
    scheduler.add_job(
        _run_weekly_plan_job,
        trigger="cron",
        day_of_week=day_of_week,
        hour=settings.weekly_job_hour,
        minute=settings.weekly_job_minute,
        id="weekly_plan_job",
        replace_existing=True,
    )
    scheduler.add_job(
        _run_intervention_job,
        trigger="cron",
        day_of_week=day_of_week,
        hour=settings.weekly_job_hour,
        minute=settings.weekly_job_minute,
        id="interventions_job",
        replace_existing=True,
    )
    logger.info(
        "Registered scheduler jobs (day=%s, time=%02d:%02d %s)",
        day_of_week,
        settings.weekly_job_hour,
        settings.weekly_job_minute,
        settings.scheduler_timezone,
    )


def _run_weekly_plan_job() -> None:
    session = SessionLocal()
    try:
        result = run_weekly_plan_for_all_users(session)
        logger.info(
            "Weekly plan job complete: users=%s, snapshots=%s",
            result.users_processed,
            result.snapshots_written,
        )
    except Exception:  # pragma: no cover - defensive guard
        logger.exception("Weekly plan job failed")
    finally:
        session.close()


def _run_intervention_job() -> None:
    session = SessionLocal()
    try:
        result = run_interventions_for_all_users(session)
        logger.info(
            "Intervention job complete: users=%s, snapshots=%s",
            result.users_processed,
            result.snapshots_written,
        )
    except Exception:  # pragma: no cover - defensive guard
        logger.exception("Intervention job failed")
    finally:
        session.close()


if __name__ == "__main__":  # pragma: no cover - manual launch
    main()
