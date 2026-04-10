from __future__ import annotations

from agents.registry import get_agent
from agents.prompt_builder import build_system_prompt
from config import load_yaml, settings
from tools.mcp.manager import get_mcp_tools


def build_agent_context(agent_name: str) -> dict:
    """Build the context needed to run an agent.

    Returns a dict with:
    - system_prompt: str (assembled from workspace files + agent prompt)
    - temperature: float
    - tool_names: list of tool names the agent can use
    - tools: list of OpenAI function-call tool definitions
    """
    agent = get_agent(agent_name)
    if not agent:
        agent = get_agent("general") or {
            "system_prompt": "You are Ray, a helpful assistant.",
            "temperature": 0.7,
            "tools": [],
        }

    # Load tool definitions from YAML
    tools_config = load_yaml("tools.yaml")
    all_tool_defs = {t["name"]: t for t in tools_config.get("tools", [])}

    # Filter to agent's allowed tools
    agent_tool_names = agent.get("tools", [])
    enabled_tools = []
    for name in agent_tool_names:
        t = all_tool_defs.get(name)
        if t and t.get("enabled", True):
            enabled_tools.append({
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t["description"],
                    "parameters": t["parameters"],
                },
            })

    # Include MCP tools for all agents
    mcp_tools = get_mcp_tools()
    combined_tools = enabled_tools + mcp_tools

    # Build full system prompt via the structured builder (includes capabilities listing)
    raw_prompt = agent.get("system_prompt", "You are Ray, a helpful assistant.")
    full_prompt = build_system_prompt(
        agent_prompt=raw_prompt,
        agent_name=agent.get("name", "general"),
        tools=combined_tools,
    )

    return {
        "system_prompt": full_prompt,
        "temperature": agent.get("temperature", 0.7),
        "tool_names": agent_tool_names,
        "tools": combined_tools,
        "agent_name": agent.get("name", "general"),
        "display_name": agent.get("display_name", "Ray"),
    }
