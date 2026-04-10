"""Tests for /schedule command and scheduler additions."""
import asyncio

import commands.builtin  # noqa: F401


def test_schedule_list():
    from commands.registry import execute_command
    result = asyncio.run(execute_command("schedule", "list", {}))
    assert "schedule" in result["content"].lower() or "no scheduled" in result["content"].lower()


def test_schedule_command_registered():
    from commands.registry import list_commands
    names = [c["name"] for c in list_commands()]
    assert "/schedule" in names


def test_compact_command_registered():
    from commands.registry import list_commands
    names = [c["name"] for c in list_commands()]
    assert "/compact" in names


def test_local_actions_schedule_parsing():
    from agents.local_actions import _try_create_schedule
    # No markers - should return None
    assert _try_create_schedule("Just a normal response") is None


def test_local_actions_memory_detection():
    from agents.local_actions import _wants_to_remember
    assert _wants_to_remember("I'll remember that for next time") is True
    assert _wants_to_remember("Hello, how are you?") is False
    assert _wants_to_remember("Noted your preference for British English") is True


def testis_valid_cron_accepts_good_expressions():
    from tasks.scheduler import is_valid_cron
    assert is_valid_cron("0 8 * * *") is True
    assert is_valid_cron("30 8 * * 1-5") is True
    assert is_valid_cron("*/15 * * * *") is True
    assert is_valid_cron("0 9 * * 1") is True
    assert is_valid_cron("0 0 1 1 *") is True


def testis_valid_cron_rejects_natural_language():
    from tasks.scheduler import is_valid_cron
    assert is_valid_cron("daily at 8:30am on weekdays") is False
    assert is_valid_cron("every day at noon") is False
    assert is_valid_cron("monday 9am") is False
    assert is_valid_cron("hello world foo bar baz") is False


def test_schedule_natural_language_triggers_redirect():
    """Natural language input should produce a redirect, not a cron parse error."""
    from commands.registry import execute_command
    result = asyncio.run(execute_command("schedule", "daily at 8:30am on weekdays only. Message me a joke", {}))
    # Should redirect to agent for parsing, not return an error
    assert result.get("type") == "redirect" or "error" not in result.get("content", "").lower()


def test_schedule_natural_language_short_input_triggers_redirect():
    """Short natural language input (< 6 tokens) should also redirect."""
    from commands.registry import execute_command
    result = asyncio.run(execute_command("schedule", "daily at 8am greet me", {}))
    assert result.get("type") == "redirect"


def test_schedule_valid_cron_with_prompt():
    """A valid 5-field cron followed by a prompt should work directly."""
    from commands.registry import execute_command
    # This will fail because scheduler isn't running in tests, but should NOT redirect
    result = asyncio.run(execute_command("schedule", "0 8 * * 1-5 Tell me a joke", {}))
    # Either succeeds or fails with scheduler error (not a redirect)
    assert result.get("type") != "redirect"


def test_schedule_endpoint(client):
    resp = client.post("/api/chat", json={
        "messages": [{"role": "user", "content": "/schedule list"}],
    })
    assert resp.status_code == 200
