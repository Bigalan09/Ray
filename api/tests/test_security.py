def test_health_always_accessible(client):
    resp = client.get("/health")
    assert resp.status_code == 200


def test_auth_status_shows_disabled_by_default(client):
    resp = client.get("/api/auth/status")
    assert resp.status_code == 200
    assert resp.json()["auth_enabled"] is False


def test_audit_log_returns_list(client):
    resp = client.get("/api/audit")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_scheduler_status_returns_list(client):
    resp = client.get("/api/scheduler/status")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)
