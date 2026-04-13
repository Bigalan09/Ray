"""Tests for retry helpers and error handling in chat.py."""

import json
from unittest.mock import patch


def test_parse_wait_time_from_retry_after_header():
    from routers.chat import _parse_wait_time
    assert _parse_wait_time("", "30") == 30.0
    assert _parse_wait_time("", "1.5") == 1.5


def test_parse_wait_time_from_error_text_seconds():
    from routers.chat import _parse_wait_time
    result = _parse_wait_time("Please retry after 10 seconds")
    assert result == 10.0


def test_parse_wait_time_from_error_text_minutes():
    from routers.chat import _parse_wait_time
    result = _parse_wait_time("retry after 2 minutes")
    assert result == 120.0


def test_parse_wait_time_from_error_text_ms():
    from routers.chat import _parse_wait_time
    result = _parse_wait_time("retry after 500 ms")
    assert result == 0.5


def test_parse_wait_time_no_match():
    from routers.chat import _parse_wait_time
    assert _parse_wait_time("some random error") == 0


def test_is_retryable_429():
    from routers.chat import _is_retryable
    assert _is_retryable(429) is True


def test_is_retryable_500():
    from routers.chat import _is_retryable
    assert _is_retryable(500) is True
    assert _is_retryable(502) is True
    assert _is_retryable(503) is True


def test_is_retryable_400_not_retryable():
    from routers.chat import _is_retryable
    assert _is_retryable(400) is False
    assert _is_retryable(401) is False
    assert _is_retryable(404) is False


def test_sse_error_format():
    from routers.chat import _sse_error
    event = _sse_error("Something went wrong", retryable=True)
    parsed = json.loads(event["data"])
    assert parsed["type"] == "error"
    assert parsed["message"] == "Something went wrong"
    assert parsed["retryable"] is True


def test_sse_error_includes_context_fields():
    from routers.chat import _sse_error

    event = _sse_error(
        "Something went wrong",
        retryable=False,
        request_id="req-123",
        tool_name="calculator",
        round_number=2,
        provider="openai",
        model="gpt-5-nano",
    )
    parsed = json.loads(event["data"])
    assert parsed == {
        "type": "error",
        "message": "Something went wrong",
        "retryable": False,
        "request_id": "req-123",
        "tool_name": "calculator",
        "round": 2,
        "provider": "openai",
        "model": "gpt-5-nano",
    }


def test_chat_pre_stream_failure_returns_structured_sse_error(client):
    with patch("routers.chat.route_message", side_effect=RuntimeError("boom")):
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "hello"}],
        })

    assert resp.status_code == 200
    assert 'text/event-stream' in resp.headers["content-type"]
    body = resp.text
    assert 'data: {"type": "error"' in body
    assert '"request_id"' in body
    assert "data: [DONE]" in body


def test_chat_tool_serialisation_failure_is_normalised_without_internal_error(client):
    async def fake_stream_chat(*args, **kwargs):
        yield 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"calculator"}}]}}]}'
        yield 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"expression\\": \\"2+2\\"}"}}]}}]}'
        yield 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}'
        yield "data: [DONE]"

    async def fake_execute_tool(name, arguments):
        return {"bad": {1, 2, 3}}

    with patch("routers.chat.resolve_model_provider", return_value=(type("P", (), {"stream_chat": fake_stream_chat})(), "gpt-5-nano")), \
         patch("routers.chat.build_agent_context", return_value={"system_prompt": "You are Ray.", "temperature": 0.2, "tools": []}), \
         patch("routers.chat._execute_tool", side_effect=fake_execute_tool):
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "calculate 2+2"}],
        })

    assert resp.status_code == 200
    body = resp.text
    assert "data: [DONE]" in body
    assert 'data: {"type": "error"' not in body
    assert '"bad": [1, 2, 3]' in body


def test_chat_missing_tool_call_id_returns_structured_sse_error(client):
    async def fake_stream_chat(*args, **kwargs):
        yield 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"type":"function","function":{"name":"calculator","arguments":"{\\"expression\\": \\"2+2\\"}"}}]}}]}'
        yield 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}'
        yield "data: [DONE]"

    with patch("routers.chat.resolve_model_provider", return_value=(type("P", (), {"stream_chat": fake_stream_chat})(), "gpt-5-nano")), \
         patch("routers.chat.build_agent_context", return_value={"system_prompt": "You are Ray.", "temperature": 0.2, "tools": []}):
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "calculate 2+2"}],
        })

    assert resp.status_code == 200
    body = resp.text
    assert 'data: {"type": "error"' in body
    assert '"tool_name":"calculator"' in body or '"tool_name": "calculator"' in body
    assert "data: [DONE]" in body


def test_chat_malformed_tool_arguments_returns_structured_sse_error(client):
    async def fake_stream_chat(*args, **kwargs):
        yield 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"calculator","arguments":"not-json"}}]}}]}'
        yield 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls","index":0}]}'
        yield "data: [DONE]"

    with patch("routers.chat.resolve_model_provider", return_value=(type("P", (), {"stream_chat": fake_stream_chat})(), "gpt-5-nano")), \
         patch("routers.chat.build_agent_context", return_value={"system_prompt": "You are Ray.", "temperature": 0.2, "tools": []}):
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "calculate 2+2"}],
        })

    assert resp.status_code == 200
    body = resp.text
    assert 'data: {"type": "error"' in body
    assert '"tool_name":"calculator"' in body or '"tool_name": "calculator"' in body
    assert "data: [DONE]" in body


def test_retryable_stream_error():
    from llm.providers import RetryableStreamError
    exc = RetryableStreamError(429, "Rate limited", retry_after="30")
    assert exc.status == 429
    assert exc.retry_after == "30"
    assert "429" in str(exc)
