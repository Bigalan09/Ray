from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path

from config import settings

DB_PATH = settings.data_dir / "tasks.db"


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


def _get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id TEXT PRIMARY KEY,
            type TEXT NOT NULL,
            agent TEXT NOT NULL DEFAULT 'general',
            prompt TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            result TEXT,
            error TEXT,
            parent_id TEXT,
            conversation_id TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT
        )
    """)
    # Migration: add conversation_id column if missing (existing databases)
    try:
        conn.execute("ALTER TABLE tasks ADD COLUMN conversation_id TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass  # column already exists
    conn.commit()
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_task(
    task_type: str,
    prompt: str,
    agent: str = "general",
    parent_id: str | None = None,
    metadata: dict | None = None,
) -> dict:
    db = _get_db()
    task_id = str(uuid.uuid4())
    now = _now()
    db.execute(
        """INSERT INTO tasks (id, type, agent, prompt, status, parent_id, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (task_id, task_type, agent, prompt, TaskStatus.PENDING, parent_id,
         json.dumps(metadata) if metadata else None, now),
    )
    db.commit()
    db.close()
    return {"id": task_id, "type": task_type, "agent": agent, "prompt": prompt,
            "status": TaskStatus.PENDING, "created_at": now}


def update_task_status(
    task_id: str,
    status: TaskStatus,
    result: str | None = None,
    error: str | None = None,
) -> bool:
    db = _get_db()
    now = _now()
    updates = ["status = ?"]
    params: list = [status]

    if status == TaskStatus.RUNNING:
        updates.append("started_at = ?")
        params.append(now)
    if status in (TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED):
        updates.append("completed_at = ?")
        params.append(now)
    if result is not None:
        updates.append("result = ?")
        params.append(result)
    if error is not None:
        updates.append("error = ?")
        params.append(error)

    params.append(task_id)
    cursor = db.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    db.close()
    return cursor.rowcount > 0


def get_task(task_id: str) -> dict | None:
    db = _get_db()
    row = db.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    db.close()
    if not row:
        return None
    return _row_to_dict(row)


def list_tasks(
    status: str | None = None,
    task_type: str | None = None,
    parent_id: str | None = None,
    limit: int = 50,
) -> list[dict]:
    db = _get_db()
    query = "SELECT * FROM tasks WHERE 1=1"
    params: list = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if task_type:
        query += " AND type = ?"
        params.append(task_type)
    if parent_id:
        query += " AND parent_id = ?"
        params.append(parent_id)
    query += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = db.execute(query, params).fetchall()
    db.close()
    return [_row_to_dict(r) for r in rows]


def set_task_conversation(task_id: str, conversation_id: str) -> bool:
    db = _get_db()
    cursor = db.execute(
        "UPDATE tasks SET conversation_id = ? WHERE id = ?",
        (conversation_id, task_id),
    )
    db.commit()
    db.close()
    return cursor.rowcount > 0


def cancel_task(task_id: str) -> bool:
    return update_task_status(task_id, TaskStatus.CANCELLED)


def _row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    if d.get("metadata"):
        try:
            d["metadata"] = json.loads(d["metadata"])
        except (json.JSONDecodeError, TypeError):
            pass
    return d
