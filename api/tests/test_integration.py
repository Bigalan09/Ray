"""Live integration tests that hit the real OpenAI Responses API.

These tests require valid credentials in .env. They verify the full
pipeline: HTTP request through FastAPI, into the OpenAI Responses API,
streaming back through SSE, and persisting to the conversation store.

Run with: python -m pytest tests/test_integration.py -v
"""
import json
import time

import pytest

from config import settings


# Skip the entire module if OpenAI credentials are not configured
pytestmark = pytest.mark.skipif(
    not settings.openai_api_key,
    reason="OPENAI_API_KEY not set",
)


def _parse_sse_events(raw: str) -> list[dict]:
    """Parse an SSE response body into a list of JSON events."""
    events = []
    for line in raw.splitlines():
        if not line.startswith("data: "):
            continue
        data = line[6:].strip()
        if data == "[DONE]":
            events.append({"_done": True})
            continue
        try:
            events.append(json.loads(data))
        except json.JSONDecodeError:
            pass
    return events


def _extract_text(events: list[dict]) -> str:
    """Concatenate all delta content from SSE events."""
    parts = []
    for ev in events:
        content = ev.get("choices", [{}])[0].get("delta", {}).get("content")
        if content:
            parts.append(content)
    return "".join(parts)


class TestLiveChat:
    """Tests that send real messages through the OpenAI Responses API."""

    def test_simple_message_returns_streamed_response(self, client):
        """Send a basic message and verify we get streamed text back."""
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "Say hello in exactly three words."}],
        })
        assert resp.status_code == 200

        events = _parse_sse_events(resp.text)
        text = _extract_text(events)

        assert len(text) > 0, "Expected non-empty response from agent"
        assert any(ev.get("_done") for ev in events), "Expected [DONE] marker"

    def test_response_contains_finish_reason(self, client):
        """The stream should include a finish_reason='stop' event."""
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "Reply with just the word 'ok'."}],
        })
        assert resp.status_code == 200

        events = _parse_sse_events(resp.text)
        finish_events = [
            ev for ev in events
            if ev.get("choices", [{}])[0].get("finish_reason") == "stop"
        ]
        assert len(finish_events) > 0, "Expected a finish_reason='stop' event"

    def test_multi_turn_conversation(self, client):
        """Send a two-turn conversation and verify the agent uses context."""
        resp = client.post("/api/chat", json={
            "messages": [
                {"role": "user", "content": "My name is TestUser."},
                {"role": "assistant", "content": "Hello TestUser!"},
                {"role": "user", "content": "What is my name?"},
            ],
        })
        assert resp.status_code == 200

        events = _parse_sse_events(resp.text)
        text = _extract_text(events).lower()
        assert "testuser" in text, f"Expected agent to recall 'TestUser', got: {text[:200]}"

    def test_conversation_persisted_after_chat(self, client):
        """Create a conversation, chat, and verify the response is saved."""
        # Create conversation
        conv_resp = client.post("/api/conversations", json={"title": "Integration Test"})
        assert conv_resp.status_code == 200
        conv_id = conv_resp.json()["id"]

        # Save user message
        client.post(f"/api/conversations/{conv_id}/messages", json={
            "role": "user",
            "content": "Say the word 'persisted'.",
        })

        # Chat with conversation_id so the response gets saved
        chat_resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "Say the word 'persisted'."}],
            "conversation_id": conv_id,
        })
        assert chat_resp.status_code == 200

        events = _parse_sse_events(chat_resp.text)
        response_text = _extract_text(events)
        assert len(response_text) > 0

        # Verify the assistant message was persisted
        conv_data = client.get(f"/api/conversations/{conv_id}").json()
        messages = conv_data.get("messages", [])
        assistant_msgs = [m for m in messages if m["role"] == "assistant"]
        assert len(assistant_msgs) > 0, "Expected assistant message to be persisted"

        # Cleanup
        client.delete(f"/api/conversations/{conv_id}")

    def test_sse_format_from_live_api(self, client):
        """Verify the live SSE stream matches the format the UI expects."""
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "Say hi."}],
        })
        assert resp.status_code == 200

        # Every non-empty line should be "data: ..." or empty
        for line in resp.text.splitlines():
            stripped = line.strip()
            if not stripped:
                continue
            assert stripped.startswith("data: ") or stripped.startswith("event: ") or stripped.startswith(":"), \
                f"Unexpected SSE line format: {stripped[:100]}"

        # Should contain at least one content delta and a DONE
        events = _parse_sse_events(resp.text)
        has_content = any(
            ev.get("choices", [{}])[0].get("delta", {}).get("content")
            for ev in events
        )
        has_done = any(ev.get("_done") for ev in events)
        assert has_content, "No content deltas in SSE stream"
        assert has_done, "No [DONE] marker in SSE stream"
