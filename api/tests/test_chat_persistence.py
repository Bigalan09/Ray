"""Regression tests for chat persistence edge cases."""

from __future__ import annotations

import json
from unittest.mock import patch


class _FakeStreamProvider:
    async def stream_chat(self, messages, temperature, tools=None, model=None):
        yield 'data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}'
        yield 'data: {"choices":[{"delta":{},"index":0,"finish_reason":"stop"}]}'
        yield "data: [DONE]"


def test_chat_persists_response_without_logging_error(client):
    """A normal chat response should persist cleanly without hitting the error logger."""
    from memory.conversation import get_conversation

    conversation = client.post("/api/conversations", json={"title": "Persistence test"}).json()

    with (
        patch("routers.chat.resolve_model_provider", return_value=(_FakeStreamProvider(), "test-model")),
        patch("routers.chat.route_message", return_value="general"),
        patch("routers.chat.build_agent_context", return_value={
            "system_prompt": "You are Ray.",
            "temperature": 0.7,
            "tools": [],
        }),
        patch("routers.chat.log.warning") as mock_warning,
    ):
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "hello"}],
            "conversation_id": conversation["id"],
        })

    assert resp.status_code == 200
    assert any("Hello" in line for line in resp.text.splitlines())

    persisted = get_conversation(conversation["id"])
    assert persisted is not None
    assistant_messages = [m for m in persisted["messages"] if m["role"] == "assistant"]
    assert any(m["content"] == "Hello" for m in assistant_messages)
    mock_warning.assert_not_called()


def test_chat_with_missing_conversation_id_does_not_log_persistence_failure(client):
    """An invalid conversation id should not trigger a foreign key persistence error."""
    with (
        patch("routers.chat.resolve_model_provider", return_value=(_FakeStreamProvider(), "test-model")),
        patch("routers.chat.route_message", return_value="general"),
        patch("routers.chat.build_agent_context", return_value={
            "system_prompt": "You are Ray.",
            "temperature": 0.7,
            "tools": [],
        }),
        patch("routers.chat.log.warning") as mock_warning,
    ):
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "hello"}],
            "conversation_id": "missing-conversation",
        })

    assert resp.status_code == 200
    assert any("Hello" in line for line in resp.text.splitlines())
    mock_warning.assert_not_called()
