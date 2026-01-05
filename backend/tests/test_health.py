from fastapi.testclient import TestClient


def _get_client() -> TestClient:
    from app.main import app

    return TestClient(app)


def test_health_endpoint_returns_ok() -> None:
    client = _get_client()
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_request_id_generated_and_returned() -> None:
    client = _get_client()
    response = client.get("/health")

    assert response.headers.get("X-Request-Id")


def test_request_id_echoed_from_header() -> None:
    client = _get_client()
    req_id = "test-request-id-123"
    response = client.get("/health", headers={"X-Request-Id": req_id})

    assert response.headers.get("X-Request-Id") == req_id
