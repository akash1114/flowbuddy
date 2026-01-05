"""Tests ensuring observability wiring is safe by default."""
from __future__ import annotations

import importlib


def test_app_import_succeeds_when_opik_is_disabled(monkeypatch) -> None:
    monkeypatch.setenv("OPIK_ENABLED", "false")
    monkeypatch.delenv("OPIK_API_KEY", raising=False)

    import app.core.config as core_config
    import app.observability.client as client_module
    import app.main as main_module

    importlib.reload(core_config)
    importlib.reload(client_module)
    reloaded_app = importlib.reload(main_module)

    assert hasattr(reloaded_app, "app")
