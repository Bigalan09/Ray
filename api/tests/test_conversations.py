import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def temp_data_dir(monkeypatch):
    """Use a temporary directory for the SQLite database."""
    with tempfile.TemporaryDirectory() as tmpdir:
        monkeypatch.setattr("config.settings.data_dir", Path(tmpdir))
        # Also reset the module-level DB_PATH
        import memory.conversation as conv_mod
        conv_mod.DB_PATH = Path(tmpdir) / "conversations.db"
        yield tmpdir


def test_create_conversation(client):
    resp = client.post("/api/conversations", json={"title": "Test Chat"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["title"] == "Test Chat"
    assert "id" in data


def test_list_conversations(client):
    client.post("/api/conversations", json={"title": "Chat 1"})
    client.post("/api/conversations", json={"title": "Chat 2"})
    resp = client.get("/api/conversations")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2


def test_get_conversation_with_messages(client):
    # Create conversation
    create_resp = client.post("/api/conversations", json={"title": "Test"})
    conv_id = create_resp.json()["id"]

    # Add messages
    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user", "content": "Hello"
    })
    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "assistant", "content": "Hi there!"
    })

    # Get conversation with messages
    resp = client.get(f"/api/conversations/{conv_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data["messages"]) == 2
    assert data["messages"][0]["role"] == "user"
    assert data["messages"][1]["role"] == "assistant"


def test_delete_conversation(client):
    create_resp = client.post("/api/conversations", json={"title": "To Delete"})
    conv_id = create_resp.json()["id"]

    resp = client.delete(f"/api/conversations/{conv_id}")
    assert resp.status_code == 200

    resp = client.get(f"/api/conversations/{conv_id}")
    assert resp.status_code == 404


def test_update_conversation_title(client):
    create_resp = client.post("/api/conversations", json={"title": "Old Title"})
    conv_id = create_resp.json()["id"]

    resp = client.patch(f"/api/conversations/{conv_id}", json={"title": "New Title"})
    assert resp.status_code == 200

    resp = client.get(f"/api/conversations/{conv_id}")
    assert resp.json()["title"] == "New Title"


def test_auto_title_does_not_crash_without_event_loop(client):
    """auto_title() fires a background async task. Without a running event
    loop (as in tests) it must silently no-op rather than raise."""
    create_resp = client.post("/api/conversations", json={})
    conv_id = create_resp.json()["id"]
    assert create_resp.json()["title"] == "New Chat"

    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user", "content": "How do I configure Docker Compose?"
    })

    # Should not raise even without a running event loop
    from memory.conversation import auto_title
    auto_title(conv_id)

    # Title stays 'New Chat' in tests because the async LLM task cannot run
    # without a running event loop — that's the expected behaviour here.
    resp = client.get(f"/api/conversations/{conv_id}")
    assert resp.json()["title"] == "New Chat"


def test_nonexistent_conversation_returns_404(client):
    resp = client.get("/api/conversations/nonexistent-id")
    assert resp.status_code == 404


def test_plain_text_content_stays_as_string(client):
    """Message content that is plain text must remain a string, even if
    it happens to be valid JSON (e.g. a dict or number)."""
    create_resp = client.post("/api/conversations", json={"title": "JSON round-trip"})
    conv_id = create_resp.json()["id"]

    cases = [
        ("Hello, world!", "Hello, world!"),
        ('{"key": "value"}', '{"key": "value"}'),
        ("42", "42"),
        ("true", "true"),
        ("null", "null"),
    ]
    for content, expected in cases:
        client.post(f"/api/conversations/{conv_id}/messages", json={
            "role": "assistant", "content": content,
        })

    resp = client.get(f"/api/conversations/{conv_id}")
    messages = resp.json()["messages"]
    assert len(messages) == len(cases)
    for msg, (_, expected) in zip(messages, cases):
        assert isinstance(msg["content"], str), (
            f"Expected string for {expected!r}, got {type(msg['content']).__name__}"
        )
        assert msg["content"] == expected


def test_multipart_content_round_trips_as_list(client):
    """Multi-part (image) messages stored as JSON arrays must parse back to lists."""
    create_resp = client.post("/api/conversations", json={"title": "Multi-part"})
    conv_id = create_resp.json()["id"]

    parts = [
        {"type": "text", "text": "Describe this image"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
    ]
    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user", "content": parts,
    })

    resp = client.get(f"/api/conversations/{conv_id}")
    msg = resp.json()["messages"][0]
    assert isinstance(msg["content"], list)
    assert msg["content"][0]["type"] == "text"
    assert msg["content"][1]["type"] == "image_url"


def test_list_conversations_ordered_by_most_recent(client):
    """Conversations must be returned most-recent first so the UI can
    auto-restore the latest session on page load."""
    import time

    first = client.post("/api/conversations", json={"title": "First"}).json()
    time.sleep(0.05)
    second = client.post("/api/conversations", json={"title": "Second"}).json()

    resp = client.get("/api/conversations?source=chat")
    data = resp.json()
    assert len(data) >= 2
    assert data[0]["id"] == second["id"], "Most recent conversation should be first"
    assert data[1]["id"] == first["id"]


def test_get_conversation_messages_include_user_and_assistant(client):
    """Both user and assistant messages must appear when loading a conversation,
    confirming the persistence path works end-to-end."""
    create_resp = client.post("/api/conversations", json={"title": "Full chat"})
    conv_id = create_resp.json()["id"]

    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "user", "content": "What is 2+2?"
    })
    client.post(f"/api/conversations/{conv_id}/messages", json={
        "role": "assistant", "content": "4"
    })

    resp = client.get(f"/api/conversations/{conv_id}")
    messages = resp.json()["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "user"
    assert messages[0]["content"] == "What is 2+2?"
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == "4"
