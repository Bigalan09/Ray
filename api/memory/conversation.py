from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import settings

DB_PATH = settings.data_dir / "conversations.db"


def _get_db() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT 'New Chat',
            model TEXT,
            prompt TEXT,
            source TEXT NOT NULL DEFAULT 'chat',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    # Migration: add source column if missing (existing databases)
    try:
        conn.execute("ALTER TABLE conversations ADD COLUMN source TEXT NOT NULL DEFAULT 'chat'")
        conn.commit()
    except sqlite3.OperationalError:
        pass  # column already exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            metadata TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    return conn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_conversation(title: str = "New Chat", model: str | None = None, prompt: str | None = None, source: str = "chat") -> dict:
    db = _get_db()
    conv_id = str(uuid.uuid4())
    now = _now()
    db.execute(
        "INSERT INTO conversations (id, title, model, prompt, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (conv_id, title, model, prompt, source, now, now),
    )
    db.commit()
    db.close()
    from hooks.engine import emit_sync
    emit_sync("session_created", {"conversation_id": conv_id, "title": title, "source": source})
    return {"id": conv_id, "title": title, "model": model, "prompt": prompt, "source": source, "created_at": now, "updated_at": now}


def list_conversations(limit: int = 50, source: str | None = None) -> list[dict]:
    db = _get_db()
    if source:
        rows = db.execute(
            "SELECT * FROM conversations WHERE source = ? ORDER BY updated_at DESC LIMIT ?", (source, limit)
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
    db.close()
    return [dict(r) for r in rows]


def get_conversation(conv_id: str) -> dict | None:
    db = _get_db()
    row = db.execute("SELECT * FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if not row:
        db.close()
        return None
    conv = dict(row)
    messages = db.execute(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC", (conv_id,)
    ).fetchall()
    db.close()
    conv["messages"] = [_msg_row_to_dict(m) for m in messages]
    return conv


def conversation_exists(conv_id: str) -> bool:
    db = _get_db()
    try:
        row = db.execute("SELECT 1 FROM conversations WHERE id = ?", (conv_id,)).fetchone()
        return row is not None
    finally:
        db.close()


def delete_conversation(conv_id: str) -> bool:
    db = _get_db()
    cursor = db.execute("DELETE FROM conversations WHERE id = ?", (conv_id,))
    db.commit()
    db.close()
    if cursor.rowcount > 0:
        from hooks.engine import emit_sync
        emit_sync("session_deleted", {"conversation_id": conv_id})
        return True
    return False


def delete_all_conversations() -> int:
    """Delete all conversations and their messages. Returns count deleted."""
    db = _get_db()
    count = db.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
    db.execute("DELETE FROM messages")
    db.execute("DELETE FROM conversations")
    db.commit()
    db.close()
    return count


def update_conversation_title(conv_id: str, title: str) -> bool:
    db = _get_db()
    cursor = db.execute(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?",
        (title, _now(), conv_id),
    )
    db.commit()
    db.close()
    return cursor.rowcount > 0


def add_message(conv_id: str, role: str, content: str | list, metadata: dict | None = None) -> dict:
    db = _get_db()
    try:
        msg_id = str(uuid.uuid4())
        now = _now()
        content_str = json.dumps(content) if isinstance(content, list) else content
        metadata_str = json.dumps(metadata) if metadata else None
        db.execute(
            "INSERT INTO messages (id, conversation_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (msg_id, conv_id, role, content_str, metadata_str, now),
        )
        db.execute("UPDATE conversations SET updated_at = ? WHERE id = ?", (now, conv_id))
        db.commit()
        return {"id": msg_id, "conversation_id": conv_id, "role": role, "content": content, "metadata": metadata, "created_at": now}
    finally:
        db.close()


def auto_title(conv_id: str) -> str | None:
    """Generate a title from the first user message if the conversation is still 'New Chat'."""
    db = _get_db()
    conv = db.execute("SELECT title FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if not conv or conv["title"] != "New Chat":
        db.close()
        return None
    first_msg = db.execute(
        "SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY created_at ASC LIMIT 1",
        (conv_id,),
    ).fetchone()
    if not first_msg:
        db.close()
        return None
    content = first_msg["content"]
    # Truncate to first 60 chars
    title = content[:60].strip()
    if len(content) > 60:
        title += "..."
    db.execute("UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?", (title, _now(), conv_id))
    db.commit()
    db.close()
    return title


def _msg_row_to_dict(row: sqlite3.Row) -> dict:
    d = dict(row)
    # Only parse JSON arrays (multi-part messages); plain text must stay
    # as a string or the frontend renderer crashes on dicts/numbers/null.
    raw = d.get("content")
    if isinstance(raw, str) and raw.startswith("["):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                d["content"] = parsed
        except (json.JSONDecodeError, TypeError):
            pass
    if d.get("metadata"):
        try:
            d["metadata"] = json.loads(d["metadata"])
        except (json.JSONDecodeError, TypeError):
            pass
    return d
