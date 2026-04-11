from __future__ import annotations

from typing import Any

import httpx
from openai import OpenAI

from config import settings


DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"

_client: OpenAI | None = None


def _normalise_base_url(base_url: str) -> str:
    return (base_url or DEFAULT_OPENAI_BASE_URL).rstrip("/")


def _get_client() -> OpenAI:
    """Get a shared OpenAI client for the Responses API."""
    global _client
    if _client is not None:
        return _client

    _client = OpenAI(
        api_key=settings.openai_api_key,
        base_url=_normalise_base_url(settings.openai_base_url),
        http_client=httpx.Client(verify=settings.tls_verify),
    )
    return _client


def _split_system_message(messages: list[dict]) -> tuple[str | None, list[dict]]:
    """Extract the leading system message into Responses instructions."""
    if not messages:
        return None, []

    first = messages[0]
    if first.get("role") != "system":
        return None, list(messages)

    content = first.get("content", "")
    if isinstance(content, list):
        text_parts = [part.get("text", "") for part in content if part.get("type") == "text"]
        instructions = "\n".join(part for part in text_parts if part)
    else:
        instructions = str(content or "")

    return instructions or None, list(messages[1:])


def _convert_content(content: Any) -> Any:
    """Convert chat-style content into Responses input content."""
    if isinstance(content, list):
        parts = []
        for part in content:
            part_type = part.get("type")
            if part_type == "text":
                parts.append({"type": "input_text", "text": part.get("text", "")})
            elif part_type == "image_url":
                url = part.get("image_url", {}).get("url", "")
                if url:
                    parts.append({"type": "input_image", "image_url": url, "detail": "auto"})
        return parts
    return content


def _convert_messages(messages: list[dict]) -> tuple[str | None, list[dict]]:
    """Convert Ray's chat messages into Responses API input items."""
    instructions, remaining = _split_system_message(messages)
    converted: list[dict] = []

    for message in remaining:
        role = message.get("role")

        if role in ("user", "assistant"):
            tool_calls = message.get("tool_calls") or []
            for tool_call in tool_calls:
                if tool_call.get("type") != "function":
                    continue
                function = tool_call.get("function", {})
                converted.append({
                    "type": "function_call",
                    "call_id": tool_call.get("id", ""),
                    "name": function.get("name", ""),
                    "arguments": function.get("arguments", ""),
                })

            if "content" not in message or message.get("content") in (None, ""):
                continue

            converted_content = _convert_content(message.get("content"))
            if converted_content in (None, "", []):
                continue

            converted.append({
                "role": role,
                "content": converted_content,
            })

        elif role == "tool":
            converted.append({
                "type": "function_call_output",
                "call_id": message.get("tool_call_id", ""),
                "output": message.get("content", ""),
            })

    return instructions, converted


def _convert_tools(tools: list[dict] | None) -> list[dict]:
    """Convert chat-completions tool definitions to Responses tools."""
    converted = []
    for tool in tools or []:
        if tool.get("type") != "function":
            continue

        function = tool.get("function", tool)
        converted.append({
            "type": "function",
            "name": function.get("name", ""),
            "description": function.get("description", ""),
            "parameters": function.get("parameters", {"type": "object", "properties": {}}),
            # Ray's current tool schemas use optional fields, so keep best-effort mode.
            "strict": function.get("strict", False),
        })
    return converted


# Models that lack certain capabilities. Exact-match against model ID.
# Add a model name here to restrict it; remove to restore the capability.
_MODEL_CAPS_BLACKLIST: dict[str, set[str]] = {
    "temperature": {"gpt-5-nano"},
    "web_search_preview": {"gpt-5-nano"},
}


def _supports_temperature(model: str) -> bool:
    return model not in _MODEL_CAPS_BLACKLIST["temperature"]


def _supports_web_search_preview(model: str) -> bool:
    return model not in _MODEL_CAPS_BLACKLIST["web_search_preview"]


def build_request_kwargs(
    messages: list[dict],
    model: str,
    temperature: float | None,
    tools: list[dict] | None = None,
    stream: bool = True,
) -> dict:
    """Build `responses.create()` kwargs from Ray's current chat structures."""
    instructions, input_items = _convert_messages(messages)
    kwargs: dict[str, Any] = {
        "model": model,
        "input": input_items,
        "stream": stream,
    }
    if instructions:
        kwargs["instructions"] = instructions
    if temperature is not None and _supports_temperature(model):
        kwargs["temperature"] = temperature

    # web_search_preview is native to the Responses API; Azure/Ollama ignore it.
    converted_tools = _convert_tools(tools)
    if _supports_web_search_preview(model):
        all_tools = [{"type": "web_search_preview"}] + converted_tools
    else:
        all_tools = converted_tools
    if all_tools:
        kwargs["tools"] = all_tools

    return kwargs


def response_output_text(response: Any) -> str:
    """Extract assistant text from a Responses API response."""
    output_text = getattr(response, "output_text", None)
    if output_text:
        return output_text

    parts: list[str] = []
    for item in getattr(response, "output", []) or []:
        if getattr(item, "type", None) != "message":
            continue
        for content_part in getattr(item, "content", []) or []:
            if getattr(content_part, "type", None) == "output_text":
                parts.append(getattr(content_part, "text", ""))
    return "".join(parts)


async def shutdown_client():
    """Close the cached client on app shutdown."""
    global _client
    if _client is not None:
        _client.close()
        _client = None
