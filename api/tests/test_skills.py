"""Tests for skills system (/skill command)."""
import asyncio


def test_skill_list():
    from commands.registry import execute_command
    result = asyncio.run(execute_command("skill", "list", {}))
    assert "Available skills" in result["content"]
    assert "summarise" in result["content"]


def test_skill_execute_returns_redirect():
    from commands.registry import execute_command
    result = asyncio.run(execute_command("skill", "summarise This is a test document.", {}))
    assert result["type"] == "redirect"
    assert "This is a test document." in result["message"]
    assert result["agent"] == "general"


def test_skill_unknown():
    from commands.registry import execute_command
    result = asyncio.run(execute_command("skill", "nonexistent_skill", {}))
    assert result.get("error") is True
    assert "Unknown skill" in result["content"]


def test_skill_review_uses_general_agent():
    from commands.registry import execute_command
    result = asyncio.run(execute_command("skill", "review def foo(): pass", {}))
    assert result["type"] == "redirect"
    assert result["agent"] == "general"
    assert "def foo(): pass" in result["message"]


def test_skill_appears_in_commands_list():
    from commands.registry import list_commands
    cmds = list_commands()
    names = [c["name"] for c in cmds]
    assert "/skill" in names
