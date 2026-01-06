# FlowBuddy (SRS v2.5)

Hackathon-friendly scaffold containing a FastAPI backend plus Expo mobile client. Ticket 0 focuses on health checks, configuration, and docs so Ticket 1 can immediately wire up Alembic migrations.

## Prerequisites
- Python 3.11.7 exactly (this version matches our prod stack and keeps native deps + agent tooling reproducible)
- Node.js 18+ and npm (or Yarn)
- [Expo CLI](https://docs.expo.dev/get-started/installation/) (installed globally or via `npx`)

## Clean Setup (Backend)
1. Ensure Python 3.11.7 is available (e.g., `pyenv install 3.11.7 && pyenv local 3.11.7`).
2. Create the project virtual environment:
   ```bash
   python3.11 -m venv .venv
   source .venv/bin/activate
   ```
3. Upgrade packaging tools and install FlowBuddy with dev extras:
   ```bash
   python -m pip install --upgrade pip setuptools wheel
   python -m pip install -e backend[dev]
   ```
4. Copy environment defaults:
   ```bash
   cp backend/.env.example backend/.env
   ```
5. All future commands (`python`, `pip`, `alembic`, `uvicorn`, etc.) should be run from this activated `.venv`.

## Backend
1. Ensure Postgres is running, then create the database and apply migrations with the venv's Python:
   ```bash
   createdb flowbuddy
   cd backend
   python -m alembic upgrade head
   ```
2. Run the API locally (venv still active):
   ```bash
   cd backend
   python -m uvicorn app.main:app --reload
   ```
3. Start the scheduler worker (only when `SCHEDULER_ENABLED=true`):
   ```bash
   cd backend
   python -m app.worker.scheduler_main
   # or, if installed as a package: flowbuddy-scheduler
   ```
   The worker validates `WEEKLY_JOB_*` env vars at startup. If `SCHEDULER_ENABLED=false`, it logs a warning (“Scheduler worker started but SCHEDULER_ENABLED=false. No jobs will run.”) and exits without scheduling anything.

### Scheduler Monitoring
- Required env vars (see `.env.example`): `SCHEDULER_ENABLED`, `SCHEDULER_TIMEZONE`, `WEEKLY_JOB_DAY`, `WEEKLY_JOB_HOUR`, `WEEKLY_JOB_MINUTE`, `JOBS_RUN_ON_STARTUP`.
- `GET /jobs` returns the configured schedule plus the job list (`weekly_plan_job`, `interventions_job`).
- Each job run logs start/end with counts and emits metrics/traces (`jobs.weekly_plan`, `jobs.interventions`). Example log line:
  ```
  INFO | app.worker.scheduler_main | Job weekly_plan complete: users=12, snapshots=10, duration_ms=132.4
  ```
3. Run tests:
   ```bash
   cd backend
   python -m pytest
   ```

> **Note:** Always invoke Alembic as `python -m alembic <command>` so migrations run inside the repo-managed Python 3.11.7 environment—never via a globally installed CLI.

## Observability (Opik)
- Tracing is disabled by default; when `OPIK_ENABLED=false` the instrumentation is a no-op and the API runs normally.
- To enable Opik locally, export the following before starting the backend:
  ```bash
  export OPIK_ENABLED=true
  export OPIK_API_KEY=sk-YOUR-KEY
  export OPIK_PROJECT=flowbuddy-dev  # optional override
  ```
- Once enabled, run the server as usual (`source .venv/bin/activate && cd backend && python -m uvicorn app.main:app --reload`) and Opik will log traces such as `http.health_check` for `/health`, with dot-delimited names reused across domains.

## Brain Dump API (Ticket 3)
- Endpoint: `POST /brain-dump`
- Request body:
  ```json
  {
    "user_id": "5e0af89e-e16d-4702-b4aa-d0fafb9055c6",
    "text": "I'm overwhelmed because my focus resolution is blocked."
  }
  ```
- FlowBuddy auto-creates the `users` row if it doesn’t exist, extracts signals (emotional state, blockers, references), persists them, and returns an acknowledgement plus the extracted JSON.
- Example curl:
  ```bash
  source .venv/bin/activate
  cd backend
  curl -X POST http://localhost:8000/brain-dump \
    -H "Content-Type: application/json" \
    -d '{"user_id":"5e0af89e-e16d-4702-b4aa-d0fafb9055c6","text":"Feeling overwhelmed because my project goal is stuck. I want to focus tomorrow."}'
  ```

## Resolution Intake & Decomposer (Tickets 5-6)
- Endpoint 1: `POST /resolutions` stores a draft resolution, normalizes the title, and captures the original free-text request.
- Endpoint 2: `POST /resolutions/{resolution_id}/decompose` creates a 4–12 week outline plus Week-1 draft tasks. Tasks remain **draft only**; Ticket 7 will add approval and activation.
- Example flow:
  ```bash
  source .venv/bin/activate
  cd backend
  # Create a resolution
  curl -X POST http://localhost:8000/resolutions \
    -H "Content-Type: application/json" \
    -d '{
      "user_id":"11111111-2222-3333-4444-555555555555",
      "text":"Build a mindful morning routine that supports focus and energy.",
      "duration_weeks":8
    }'
  # Replace <resolution_id> with the id returned above
  curl -X POST http://localhost:8000/resolutions/<resolution_id>/decompose \
    -H "Content-Type: application/json" \
    -d '{"weeks":8}'
  ```
- The decomposer persists the outline inside `Resolution.metadata_json["plan_v1"]` and stores Week-1 tasks in the `tasks` table marked with `{"draft": true, "source": "decomposer_v1"}` so they can be safely reviewed before activation.
- Approval (Ticket 7) is explicit:
  - Use `POST /resolutions/<resolution_id>/approve` with `decision="accept"` to activate tasks and set the resolution status to `active`.
  - Use `decision="reject"` to keep everything in draft (logged for audit) or `decision="regenerate"` to request a fresh decomposition (then call `/decompose` with `regenerate=true`).
  ```bash
  # Accepting (can include optional task edits)
  curl -X POST http://localhost:8000/resolutions/<resolution_id>/approve \
    -H "Content-Type: application/json" \
    -d '{
      "user_id":"11111111-2222-3333-4444-555555555555",
      "decision":"accept",
      "task_edits":[
        {"task_id":"<task_uuid>", "scheduled_day":"2024-01-03", "scheduled_time":"09:00", "duration_min":30}
      ]
    }'

  # Rejecting (keeps status=draft, logs the decision)
  curl -X POST http://localhost:8000/resolutions/<resolution_id>/approve \
    -H "Content-Type: application/json" \
    -d '{
      "user_id":"11111111-2222-3333-4444-555555555555",
      "decision":"reject"
    }'
  ```

## Testing
- Default (SQLite) tests, Opik disabled:
  ```bash
  source .venv/bin/activate
  cd backend
  python -m pytest
  ```
- Optional Postgres integration tests: set `DATABASE_URL` to a test Postgres instance, run `alembic upgrade head`, and execute `python -m pytest`.
- Opik-enabled tests (requires valid `OPIK_API_KEY`):
  ```bash
  export OPIK_ENABLED=true
  export OPIK_PROJECT=flowbuddy-test
  python -m pytest backend/tests/test_observability_enabled.py
  ```

## Task Management & Dashboard (Tickets 7-12)
- **Tasks API**
  - `GET /tasks?user_id=<uuid>&status=active|draft|all`: returns active and/or draft tasks with schedule metadata and notes (stored in `tasks.metadata_json`).
  - `PATCH /tasks/{task_id}` toggles completion; also inserts an `AgentActionLog` entry.
  - `PATCH /tasks/{task_id}/note` sets or clears a note (trimmed, max 500 chars) without schema changes.
- **Resolution Dashboard**
  - `GET /dashboard?user_id=<uuid>` aggregates weekly progress across active resolutions (tasks totals/completion rate, scheduled vs unscheduled counts, and recent activity with note presence). Traces: `dashboard.get`.
  - Example:
    ```bash
    curl "http://127.0.0.1:8000/dashboard?user_id=11111111-2222-3333-4444-555555555555"
    ```

## Agent Preview & Snapshot Endpoints (Manual triggers for P0 features)
- **Weekly Micro-Resolution Generator**
  - `GET /weekly-plan/preview?user_id=<uuid>`: deterministic look-ahead preview (no writes).
  - `POST /weekly-plan/run` with JSON `{"user_id":"<uuid>", "force": false}`: generates the plan, persists a snapshot inside `AgentActionLog`, and returns it. Set `force=true` to bypass dedupe if you need to re-run the same week manually.
  - `GET /weekly-plan/latest?user_id=<uuid>`: fetches the most recent stored snapshot (404 if none).
  - `GET /weekly-plan/history?user_id=<uuid>&limit=20` lists recent snapshots; `GET /weekly-plan/history/{log_id}?user_id=<uuid>` returns the full stored payload.
  - Example curls:
    ```bash
    curl "http://127.0.0.1:8000/weekly-plan/preview?user_id=11111111-2222-3333-4444-555555555555"
    curl -X POST http://127.0.0.1:8000/weekly-plan/run -H "Content-Type: application/json" \
      -d '{"user_id":"11111111-2222-3333-4444-555555555555"}'
    curl "http://127.0.0.1:8000/weekly-plan/latest?user_id=11111111-2222-3333-4444-555555555555"
    ```
- **Basic Intervention System**
  - `GET /interventions/preview?user_id=<uuid>`: read-only preview.
  - `POST /interventions/run` with `{"user_id":"<uuid>", "force": false}`: generate + store snapshot (`force=true` bypasses dedupe).
  - `GET /interventions/latest?user_id=<uuid>`: retrieve the latest stored intervention card (404 if none).
  - `GET /interventions/history?user_id=<uuid>` and `GET /interventions/history/{log_id}?user_id=<uuid>` expose the stored intervention snapshots.
  - Example curls:
    ```bash
    curl "http://127.0.0.1:8000/interventions/preview?user_id=11111111-2222-3333-4444-555555555555"
    curl -X POST http://127.0.0.1:8000/interventions/run -H "Content-Type: application/json" \
      -d '{"user_id":"11111111-2222-3333-4444-555555555555"}'
    curl "http://127.0.0.1:8000/interventions/latest?user_id=11111111-2222-3333-4444-555555555555"
    ```

## Mobile Features
- **Home Screen** buttons:
  - Brain Dump, Draft Plans, My Week, Dashboard, New Resolution.
- **Draft Plans** lists all draft resolutions and links back into Plan Review.
- **Resolution Create + Plan Review**: mirror backend create/decompose/approve flow with client-side validation and inline task edits.
- **My Week**: shows active tasks grouped by scheduled/unscheduled sections, allows completion toggles and note editing (modal with 500-char limit). Pull-to-refresh refetches `/tasks`.
- **Dashboard**: lists active resolutions with weekly stats, completion rate, and recent activity. Tapping a card opens a detail screen that shows scheduled/unscheduled tasks for the current week plus recent completions.

## Mobile (Expo / React Native)
1. Install dependencies:
   ```bash
   cd mobile
   npm install
   ```
2. Start the Expo dev server:
   ```bash
   npm run start
   ```
3. Use the Expo Go app or an emulator (`npm run ios` / `npm run android`) to launch the app.

## Docs
- `docs/SRS_v2.5.pdf`: placeholder stored alongside this repo for convenience.
- `docs/decisions.md`: explains stack choices and guiding principles.

## Next Steps
- Ticket 1: initialize Alembic inside `backend/alembic/` and wire migrations.
- Expand API routers and mobile screens as new tickets arrive.
- **Job Ops (dev-only helpers)**
  - `GET /jobs`: surfaces scheduler configuration (enabled flag, cron settings) for observability dashboards.
  - `POST /jobs/run-now`: triggers `weekly_plan` or `interventions` jobs synchronously when `DEBUG=true`. Body example: `{ "job": "weekly_plan", "force": false }`.
  - Use these endpoints for local smoke tests; production automation should invoke the standalone scheduler worker instead.

## Preferences & Pause Controls
- `GET /preferences?user_id=<uuid>` returns the current autonomy settings. Defaults: `coaching_paused=false`, `weekly_plans_enabled=true`, `interventions_enabled=true`.
- `PATCH /preferences` with any subset (e.g., `{ "user_id": "...", "coaching_paused": true }`) updates settings and logs an `AgentActionLog` entry when values change.
- Scheduler jobs automatically skip users when `coaching_paused=true` or the corresponding feature flag (`weekly_plans_enabled`, `interventions_enabled`) is off. Skipped counts appear in job logs/metrics.
- Manual test flow:
  1. Launch the backend (`uvicorn app.main:app --reload`) and scheduler worker (`python -m app.worker.scheduler_main`).
  2. In the mobile app, open **Settings** from Home, toggle “Pause coaching” or the per-feature switches.
  3. Inspect `GET /preferences` or the Settings screen footer to verify the `request_id` and persisted values.
  4. Trigger `/jobs/run-now` or wait for the scheduler; logs show `skipped_due_to_preferences` when a user is paused/disabled.

## Notifications (stub / noop)
- Enable via `NOTIFICATIONS_ENABLED=true` and `NOTIFICATIONS_PROVIDER=noop` in `backend/.env`.
- When enabled, each newly-created weekly plan or intervention snapshot queues a no-op notification (logged as `Notification queued (noop)` plus an `AgentActionLog` entry with `action_type = notification_*`).
- Notifications respect preferences:
  - paused coaching → skipped with reason
  - weekly/intervention toggles off → skipped
  - interventions only notify when slippage is flagged
- For now, `GET /notifications/config` returns the current provider/enabled flag so ops can verify the environment before real push integrations land.
