import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def test_health_ok(test_database_url):
    client = TestClient(create_app(test_database_url))
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_health_db_down():
    client = TestClient(create_app("postgresql+psycopg://kmk:wrongpass@127.0.0.1:1/kmk"))
    r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json() == {"status": "error"}
    for leak in ("wrongpass", "psycopg", "127.0.0.1", "Traceback"):
        assert leak not in r.text


@pytest.mark.parametrize(
    "path", ["/api/docs", "/api/redoc", "/api/openapi.json", "/docs", "/openapi.json"]
)
def test_docs_not_exposed(test_database_url, path):
    client = TestClient(create_app(test_database_url))
    assert client.get(path).status_code == 404
