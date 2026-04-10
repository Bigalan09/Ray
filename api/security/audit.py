from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path

from config import settings

DB_PATH = settings.data_dir / "audit.db"

# Truncate body to this length to avoid storing huge payloads
MAX_BODY_LENGTH = 2000


def _get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            method TEXT NOT NULL,
            path TEXT NOT NULL,
            client_ip TEXT,
            status_code INTEGER,
            duration_ms REAL,
            user_agent TEXT,
            request_body TEXT
        )
    """)
    # Migration: add request_body column if missing
    try:
        conn.execute("SELECT request_body FROM audit_log LIMIT 0")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE audit_log ADD COLUMN request_body TEXT")
    conn.commit()
    return conn


def log_request(
    method: str,
    path: str,
    client_ip: str,
    status_code: int = 0,
    duration_ms: float = 0,
    user_agent: str | None = None,
    request_body: str | None = None,
):
    """Write an audit log entry."""
    try:
        # Truncate and sanitise the body
        body = None
        if request_body:
            body = request_body[:MAX_BODY_LENGTH]
            # Strip API keys from the body if present
            try:
                parsed = json.loads(body)
                for key in ("api_key", "password", "secret", "token"):
                    if key in parsed:
                        parsed[key] = "[REDACTED]"
                body = json.dumps(parsed)
            except (json.JSONDecodeError, TypeError):
                pass

        db = _get_db()
        db.execute(
            "INSERT INTO audit_log (timestamp, method, path, client_ip, status_code, duration_ms, user_agent, request_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (datetime.now(timezone.utc).isoformat(), method, path, client_ip, status_code, duration_ms, user_agent, body),
        )
        db.commit()
        db.close()
    except Exception:
        pass


def get_audit_log(limit: int = 100) -> list[dict]:
    """Read recent audit log entries."""
    try:
        db = _get_db()
        rows = db.execute(
            "SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,)
        ).fetchall()
        db.close()
        columns = ["id", "timestamp", "method", "path", "client_ip", "status_code", "duration_ms", "user_agent", "request_body"]
        return [dict(zip(columns, r)) for r in rows]
    except Exception:
        return []
