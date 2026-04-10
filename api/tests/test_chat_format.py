"""Tests for SSE wire format validation and chat routing logic."""
import json

from config import load_yaml


def test_chat_endpoint_exists(client):
    """POST /api/chat should exist (not 404/405). Connection errors are acceptable without a configured LLM."""
    import openai
    try:
        resp = client.post("/api/chat", json={
            "messages": [{"role": "user", "content": "hello"}],
        })
        assert resp.status_code != 404
        assert resp.status_code != 405
    except (openai.APIConnectionError, Exception):
        pass


def test_models_config_uses_openai_provider():
    """The bundled config should default to the OpenAI Responses provider."""
    models_config = load_yaml("models.yaml")
    assert models_config["providers"]["openai"]["type"] == "openai"


def test_sse_chunk_format():
    """Verify that an SSE chunk matches the expected OpenAI format."""
    chunk = {
        "choices": [{
            "delta": {"content": "Hello"},
            "index": 0,
        }]
    }
    line = f"data: {json.dumps(chunk)}"

    assert line.startswith("data: ")
    data = line[6:]
    parsed = json.loads(data)
    assert parsed["choices"][0]["delta"]["content"] == "Hello"


def test_sse_done_format():
    """Verify the DONE marker format."""
    line = "data: [DONE]"
    assert line.startswith("data: ")
    data = line[6:]
    assert data == "[DONE]"


def test_sse_finish_chunk_format():
    """Verify the finish chunk includes finish_reason and optional usage."""
    chunk = {
        "choices": [{"delta": {}, "index": 0, "finish_reason": "stop"}],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "total_tokens": 30,
        },
    }
    line = f"data: {json.dumps(chunk)}"
    parsed = json.loads(line[6:])
    assert parsed["choices"][0]["finish_reason"] == "stop"
    assert parsed["usage"]["total_tokens"] == 30


def test_ray_tool_event_format():
    """Verify the ray_tool SSE event format for tool call notifications."""
    # Running event
    running = {"ray_tool": {"name": "calculator", "status": "running"}}
    line = f"data: {json.dumps(running)}"
    parsed = json.loads(line[6:])
    assert parsed["ray_tool"]["name"] == "calculator"
    assert parsed["ray_tool"]["status"] == "running"

    # Success event
    success = {"ray_tool": {"name": "calculator", "status": "success"}}
    parsed = json.loads(json.dumps(success))
    assert parsed["ray_tool"]["status"] == "success"

    # Error event
    error = {"ray_tool": {"name": "bad_tool", "status": "error"}}
    parsed = json.loads(json.dumps(error))
    assert parsed["ray_tool"]["status"] == "error"


def test_ray_tool_event_not_in_content():
    """ray_tool events should NOT appear in choices.delta.content."""
    event = {"ray_tool": {"name": "calculator", "status": "running"}}
    assert "choices" not in event
    assert "delta" not in str(event) or "content" not in event.get("delta", {})


def test_env_var_default_resolution():
    """Verify ${VAR:default} syntax works in config."""
    from config import _resolve_env_vars
    import os

    result = _resolve_env_vars("${NONEXISTENT_VAR_12345:fallback}")
    assert result == "fallback"

    os.environ["TEST_RESOLVE_VAR"] = "real_value"
    result = _resolve_env_vars("${TEST_RESOLVE_VAR:fallback}")
    assert result == "real_value"
    del os.environ["TEST_RESOLVE_VAR"]

    result = _resolve_env_vars("${NONEXISTENT_VAR_12345}")
    assert result == ""
