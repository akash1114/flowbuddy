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
