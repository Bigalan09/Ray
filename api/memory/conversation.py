from __future__ import annotations

import asyncio
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


def auto_title(conv_id: str) -> None:
    """Fire-and-forget LLM title generation for conversations still titled 'New Chat'."""
    db = _get_db()
    conv = db.execute("SELECT title FROM conversations WHERE id = ?", (conv_id,)).fetchone()
    if not conv or conv["title"] != "New Chat":
        db.close()
        return
    msgs = db.execute(
        "SELECT role, content FROM messages WHERE conversation_id = ? "
        "ORDER BY created_at ASC LIMIT 4",
        (conv_id,),
    ).fetchall()
    db.close()

    user_msg = next((m["content"] for m in msgs if m["role"] == "user"), "")
    asst_msg = next((m["content"] for m in msgs if m["role"] == "assistant"), "")
    if not user_msg:
        return

    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_llm_title(conv_id, user_msg, asst_msg))
    except RuntimeError:
        pass  # no running loop (tests, background worker without event loop)


async def _llm_title(conv_id: str, first_user_msg: str, first_assistant_msg: str) -> None:
    """Generate a short title via LLM and update the DB. Fire-and-forget."""
    try:
        from llm.responses import _get_client, response_output_text
        from config import load_yaml, get_default_model
        client = _get_client()
        model = get_default_model(load_yaml("models.yaml"))
        response = await asyncio.wait_for(
            asyncio.to_thread(
                client.responses.create,
                model=model,
                instructions=(
                    "Generate a 4–6 word title for this conversation. "
                    "Return ONLY the title, no punctuation, no quotes."
                ),
                input=[{"role": "user", "content":
                        f"User: {first_user_msg[:300]}\nAssistant: {first_assistant_msg[:300]}"}],
                temperature=0,
            ),
            timeout=10.0,
        )
        title = response_output_text(response).strip()[:80]
        if title:
            db = _get_db()
            db.execute(
                "UPDATE conversations SET title = ?, updated_at = ? "
                "WHERE id = ? AND title = 'New Chat'",
                (title, _now(), conv_id),
            )
            db.commit()
            db.close()
    except Exception:
        pass


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
