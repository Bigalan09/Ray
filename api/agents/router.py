from __future__ import annotations

import re

from agents.registry import get_agent, get_agent_names


def route_message(
    message: str,
    current_agent: str = "general",
    explicit_agent: str | None = None,
) -> str:
    """Determine which agent handles the message.

    Priority:
    1. Explicit agent selection (from UI or /agent command)
    2. /agent command in message text
    3. Stay with current agent (general handles everything)
    """
    if explicit_agent and get_agent(explicit_agent):
        return explicit_agent

    agent_cmd = re.match(r"^/agent\s+(\w+)", message.strip(), re.I)
    if agent_cmd:
        requested = agent_cmd.group(1).lower()
        if requested in get_agent_names():
            return requested

    return current_agent
