"""
Unit tests for central model capabilities registry (#28)
and auto_title timeout (#29).
"""
import pytest


def test_model_caps_blacklist_exists():
    from llm.responses import _MODEL_CAPS_BLACKLIST
    assert "temperature" in _MODEL_CAPS_BLACKLIST
    assert "web_search_preview" in _MODEL_CAPS_BLACKLIST


def test_gpt5_nano_does_not_support_temperature():
    from llm.responses import _supports_temperature
    assert not _supports_temperature("gpt-5-nano")


def test_gpt5_nano_does_not_support_web_search_preview():
    from llm.responses import _supports_web_search_preview
    assert not _supports_web_search_preview("gpt-5-nano")


def test_other_model_supports_temperature():
    from llm.responses import _supports_temperature
    assert _supports_temperature("gpt-4o")
    assert _supports_temperature("gpt-4o-mini")


def test_other_model_supports_web_search_preview():
    from llm.responses import _supports_web_search_preview
    assert _supports_web_search_preview("gpt-4o")


def test_adding_model_to_blacklist_takes_effect():
    """Blacklist is a mutable dict — adding a model immediately restricts it."""
    from llm.responses import _MODEL_CAPS_BLACKLIST, _supports_temperature
    _MODEL_CAPS_BLACKLIST["temperature"].add("test-restricted-model")
    try:
        assert not _supports_temperature("test-restricted-model")
    finally:
        _MODEL_CAPS_BLACKLIST["temperature"].discard("test-restricted-model")


def test_auto_title_uses_wait_for():
    """_llm_title must use asyncio.wait_for so a slow API call times out."""
    import inspect
    from memory import conversation as conv_module
    source = inspect.getsource(conv_module._llm_title)
    assert "wait_for" in source, "_llm_title must wrap the LLM call with asyncio.wait_for"


def test_agent_command_registered():
    """#13 — /agent must be in the command registry."""
    from commands.registry import ensure_commands_registered, COMMANDS
    ensure_commands_registered()
    assert "agent" in COMMANDS


@pytest.mark.asyncio
async def test_agent_list_returns_agents():
    """Requires config/agents.yaml — skips in minimal test env."""
    try:
        from agents.registry import load_agents
        if not load_agents():
            pytest.skip("No agents.yaml available")
    except Exception:
        pytest.skip("No agents.yaml available")
    from commands.builtin import _agent
    result = await _agent("list", {})
    assert "Available agents" in result["content"]
    assert "general" in result["content"]


@pytest.mark.asyncio
async def test_agent_switch_valid():
    """Requires config/agents.yaml — skips in minimal test env."""
    try:
        from agents.registry import get_agent
        if not get_agent("general"):
            pytest.skip("No agents.yaml available")
    except Exception:
        pytest.skip("No agents.yaml available")
    from commands.builtin import _agent
    result = await _agent("general", {})
    assert result.get("type") == "redirect"
    assert result.get("agent") == "general"


@pytest.mark.asyncio
async def test_agent_switch_unknown():
    """Unknown agent name is always rejected regardless of config."""
    from commands.builtin import _agent
    result = await _agent("__unknown_agent_xyz__", {})
    assert result.get("error") is True
    assert "Unknown agent" in result["content"]
