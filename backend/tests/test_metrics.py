"""Tests for metrics helpers."""
from __future__ import annotations

from typing import Any, Dict

from app.observability import metrics
from app.observability import tracing


class _DummyTrace:
    def __init__(self, metadata: Dict[str, Any]):
        self.metadata = metadata
        self.ended = False

    def end(self) -> None:
        self.ended = True


class _DummyClient:
    def __init__(self):
        self.traces: list[_DummyTrace] = []

    def trace(self, name: str, metadata: Dict[str, Any] | None = None):
        trace = _DummyTrace(metadata or {})
        self.traces.append(trace)
        return trace


def test_log_metric_closes_trace(monkeypatch) -> None:
    dummy_client = _DummyClient()
    monkeypatch.setattr(tracing, "get_opik_client", lambda: dummy_client)

    metrics.log_metric("demo_metric", 42, metadata={"foo": "bar"})

    assert dummy_client.traces, "Metric call should record a trace"
    assert dummy_client.traces[0].metadata["value"] == 42
    assert dummy_client.traces[0].metadata["foo"] == "bar"
    assert dummy_client.traces[0].ended is True
