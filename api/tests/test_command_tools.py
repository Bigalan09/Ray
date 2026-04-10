"""Tests for /tool and /task slash commands."""
import asyncio
import json


def test_tool_list():
    import commands.builtin  # noqa: F401
    from commands.registry import execute_command
    result = asyncio.run(execute_command("tool", "list", {}))
    assert "Available tools" in result["content"]
    assert "calculator" in result["content"]


def test_tool_execute_calculator():
    import commands.builtin  # noqa: F401
    from commands.registry import execute_command
    result = asyncio.run(execute_command("tool", 'calculator {"expression": "2 + 3"}', {}))
    assert result["data"]["result"] == 5.0


def test_tool_invalid_json():
    import commands.builtin  # noqa: F401
    from commands.registry import execute_command
    result = asyncio.run(execute_command("tool", "calculator not_json", {}))
    assert result.get("error") is True
    assert "Invalid JSON" in result["content"]


def test_tool_unknown_tool():
    import commands.builtin  # noqa: F401
    from commands.registry import execute_command
    result = asyncio.run(execute_command("tool", "nonexistent_tool {}", {}))
    assert result.get("error") is True


def test_task_list_empty():
    import commands.builtin  # noqa: F401
    from commands.registry import execute_command
    result = asyncio.run(execute_command("task", "list", {}))
    # Either "No tasks" or "Recent tasks" depending on state
    assert "task" in result["content"].lower()


def test_chat_tool_command(client):
    """Sending /tool list via chat should return tool listing."""
    resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "/tool list"}],
    })
    assert resp.status_code == 200
    events = []
    for line in resp.text.splitlines():
        if line.startswith("data: "):
            data = line[6:].strip()
            if data == "[DONE]":
                continue
            try:
                events.append(json.loads(data))
            except json.JSONDecodeError:
                pass
    assert len(events) > 0
    assert "calculator" in events[0].get("content", "")


def test_chat_tool_execute(client):
    """Execute calculator via /tool in chat."""
    resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": '/tool calculator {"expression": "7 * 6"}'}],
    })
    assert resp.status_code == 200
    events = []
    for line in resp.text.splitlines():
        if line.startswith("data: "):
            data = line[6:].strip()
            if data == "[DONE]":
                continue
            try:
                events.append(json.loads(data))
            except json.JSONDecodeError:
                pass
    assert events[0]["data"]["result"] == 42
