"""Tests for OpenAI Responses integration."""
import asyncio
from unittest.mock import MagicMock, patch


def test_shutdown_client_when_no_client():
    """shutdown_client should be safe to call when nothing is initialised."""
    import llm.responses as module

    original = module._client
    try:
        module._client = None
        asyncio.run(module.shutdown_client())
    finally:
        module._client = original


def test_shutdown_client_closes_client():
    """shutdown_client should call close on the cached client."""
    import llm.responses as module

    mock_client = MagicMock()
    original = module._client
    try:
        module._client = mock_client
        asyncio.run(module.shutdown_client())
        mock_client.close.assert_called_once()
        assert module._client is None
    finally:
        module._client = original


def test_split_system_message_extracts_instructions():
    """The leading system message should become Responses instructions."""
    from llm.responses import _split_system_message

    instructions, remaining = _split_system_message([
        {"role": "system", "content": "You are Ray."},
        {"role": "user", "content": "Hello"},
    ])

    assert instructions == "You are Ray."
    assert remaining == [{"role": "user", "content": "Hello"}]


def test_convert_messages_keeps_text_and_images():
    """User content parts should map to Responses input items."""
    from llm.responses import _convert_messages

    instructions, converted = _convert_messages([
        {"role": "system", "content": "Follow the rules."},
        {"role": "user", "content": [
            {"type": "text", "text": "Look at this"},
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc123"}},
        ]},
        {"role": "assistant", "content": "I can see it."},
    ])

    assert instructions == "Follow the rules."
    assert converted == [
        {
            "role": "user",
            "content": [
                {"type": "input_text", "text": "Look at this"},
                {"type": "input_image", "image_url": "data:image/png;base64,abc123", "detail": "auto"},
            ],
        },
        {"role": "assistant", "content": "I can see it."},
    ]


def test_convert_messages_maps_tool_round_trip():
    """Assistant tool calls and tool outputs should become Responses items."""
    from llm.responses import _convert_messages

    instructions, converted = _convert_messages([
        {
            "role": "assistant",
            "tool_calls": [
                {
                    "id": "call_123",
                    "type": "function",
                    "function": {
                        "name": "calculator",
                        "arguments": "{\"expression\":\"2+2\"}",
                    },
                }
            ],
        },
        {
            "role": "tool",
            "tool_call_id": "call_123",
            "content": "{\"result\":4}",
        },
    ])

    assert instructions is None
    assert converted == [
        {
            "type": "function_call",
            "call_id": "call_123",
            "name": "calculator",
            "arguments": "{\"expression\":\"2+2\"}",
        },
        {
            "type": "function_call_output",
            "call_id": "call_123",
            "output": "{\"result\":4}",
        },
    ]


def test_convert_tools_disables_strict_mode():
    """Responses should preserve the current best-effort schemas."""
    from llm.responses import _convert_tools

    converted = _convert_tools([
        {
            "type": "function",
            "function": {
                "name": "get_current_time",
                "description": "Get the current time.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "timezone": {"type": "string"},
                    },
                },
            },
        }
    ])

    assert converted == [
        {
            "type": "function",
            "name": "get_current_time",
            "description": "Get the current time.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timezone": {"type": "string"},
                },
            },
            "strict": False,
        }
    ]


def test_get_client_uses_openai_base_url_override():
    """The shared client should honour OPENAI_BASE_URL when configured."""
    import llm.responses as module
    from config import settings

    original_client = module._client
    original_base_url = settings.openai_base_url
    try:
        module._client = None
        settings.openai_base_url = "https://example.com/v1"

        with patch("llm.responses.OpenAI") as mock_openai:
            module._get_client()
            assert mock_openai.call_args.kwargs["base_url"] == "https://example.com/v1"
    finally:
        module._client = original_client
        settings.openai_base_url = original_base_url


def test_build_request_kwargs_omits_temperature_for_gpt_5_nano():
    """gpt-5-nano rejects the temperature parameter on Responses requests."""
    from llm.responses import build_request_kwargs

    kwargs = build_request_kwargs(
        messages=[{"role": "user", "content": "Hello"}],
        model="gpt-5-nano",
        temperature=0.7,
    )

    assert "temperature" not in kwargs
