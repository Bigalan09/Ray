"""Tests for security middleware (auth, rate limiting, audit logging)."""
import os
import tempfile
from pathlib import Path
from unittest.mock import patch


def test_health_bypasses_auth(client):
    """Health endpoint should be accessible without API key."""
    resp = client.get("/health")
    assert resp.status_code == 200


def test_auth_status_bypasses_auth(client):
    """Auth status endpoint is public."""
    resp = client.get("/api/auth/status")
    assert resp.status_code == 200


def test_api_accessible_when_no_key_configured(client):
    """When no API key file exists, all routes should be accessible."""
    resp = client.get("/api/models")
    assert resp.status_code == 200


def test_api_returns_401_with_wrong_key(client):
    """When API key is configured, wrong key should return 401."""
    from config import settings
    key_file = settings.data_dir / "api_key"
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key_file.write_text("test-secret-key")

    try:
        resp = client.get("/api/models", headers={"X-API-Key": "wrong-key"})
        assert resp.status_code == 401

        resp_no_key = client.get("/api/models")
        assert resp_no_key.status_code == 401
    finally:
        key_file.unlink(missing_ok=True)


def test_api_accessible_with_correct_key(client):
    """When API key is configured, correct key should grant access."""
    from config import settings
    key_file = settings.data_dir / "api_key"
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key_file.write_text("test-secret-key")

    try:
        resp = client.get("/api/models", headers={"X-API-Key": "test-secret-key"})
        assert resp.status_code == 200
    finally:
        key_file.unlink(missing_ok=True)


def test_audit_log_records_post_requests(client):
    """Mutating requests should be recorded in the audit log."""
    from security.audit import get_audit_log

    client.post("/api/conversations", json={"title": "Audit Test"})

    logs = get_audit_log(limit=5)
    post_logs = [l for l in logs if l["path"] == "/api/conversations" and l["method"] == "POST"]
    assert len(post_logs) > 0
    assert post_logs[0]["status_code"] == 200
