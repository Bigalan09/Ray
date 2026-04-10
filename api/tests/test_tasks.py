import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def temp_data_dir(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        monkeypatch.setattr("config.settings.data_dir", Path(tmpdir))
        import tasks.store as store_mod
        store_mod.DB_PATH = Path(tmpdir) / "tasks.db"
        yield tmpdir


def test_create_task(client):
    resp = client.post("/api/tasks", json={
        "prompt": "Test background task",
        "agent": "general",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["prompt"] == "Test background task"
    assert data["status"] == "pending"
    assert "id" in data


def test_list_tasks(client):
    client.post("/api/tasks", json={"prompt": "Task 1"})
    client.post("/api/tasks", json={"prompt": "Task 2"})
    resp = client.get("/api/tasks")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) >= 2


def test_get_task(client):
    create_resp = client.post("/api/tasks", json={"prompt": "Get me"})
    task_id = create_resp.json()["id"]

    resp = client.get(f"/api/tasks/{task_id}")
    assert resp.status_code == 200
    assert resp.json()["prompt"] == "Get me"


def test_cancel_task(client):
    create_resp = client.post("/api/tasks", json={"prompt": "Cancel me"})
    task_id = create_resp.json()["id"]

    resp = client.post(f"/api/tasks/{task_id}/cancel")
    assert resp.status_code == 200

    task = client.get(f"/api/tasks/{task_id}").json()
    assert task["status"] == "cancelled"


def test_nonexistent_task_returns_404(client):
    resp = client.get("/api/tasks/nonexistent")
    assert resp.status_code == 404
