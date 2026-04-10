"""Tests for slash command system."""
import asyncio
import json


def test_parse_command_basic():
    from commands.registry import parse_command
    result = parse_command("/help")
    assert result == ("help", "")


def test_parse_command_with_args():
    from commands.registry import parse_command
    result = parse_command("/tool calculator")
    assert result == ("tool", "calculator")


def test_parse_command_not_a_command():
    from commands.registry import parse_command
    assert parse_command("hello world") is None
    assert parse_command("not /a command") is None


def test_parse_command_case_insensitive():
    from commands.registry import parse_command
    result = parse_command("/HELP")
    assert result == ("help", "")


def test_list_commands():
    from commands.registry import list_commands
    cmds = list_commands()
    names = [c["name"] for c in cmds]
    assert "/help" in names
    assert "/clear" in names
    assert "/status" in names
    assert "/bootstrap" in names


def test_execute_help():
    from commands.registry import execute_command
    result = asyncio.run(
        execute_command("help", "", {})
    )
    assert result["type"] == "command_result"
    assert "Available commands" in result["content"]


def test_execute_unknown_command():
    from commands.registry import execute_command
    result = asyncio.run(
        execute_command("nonexistent", "", {})
    )
    assert result["error"] is True
    assert "Unknown command" in result["content"]


def test_execute_clear():
    from commands.registry import execute_command
    result = asyncio.run(
        execute_command("clear", "", {})
    )
    assert result.get("action") == "clear"


def test_execute_bootstrap_status():
    from commands.registry import execute_command
    result = asyncio.run(
        execute_command("bootstrap", "status", {})
    )
    assert "bootstrap" in result["content"].lower()


def test_commands_endpoint(client):
    resp = client.get("/api/commands")
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    names = [c["name"] for c in data]
    assert "/help" in names


def test_chat_slash_command(client):
    """Sending /help via chat should return command result, not LLM response."""
    resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "/help"}],
    })
    assert resp.status_code == 200
    # Parse SSE response
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
    assert events[0].get("type") == "command_result"
    assert "Available commands" in events[0].get("content", "")
