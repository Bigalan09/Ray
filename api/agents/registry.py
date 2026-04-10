from __future__ import annotations

from config import load_yaml


def load_agents() -> list[dict]:
    """Load agent definitions from YAML config."""
    config = load_yaml("agents.yaml")
    return config.get("agents", [])


def get_agent(name: str) -> dict | None:
    """Get a specific agent by name."""
    agents = load_agents()
    for agent in agents:
        if agent["name"] == name:
            return agent
    return None


def get_agent_names() -> list[str]:
    """Return list of available agent names."""
    return [a["name"] for a in load_agents()]


def get_agent_for_display() -> list[dict]:
    """Return agent info suitable for the UI."""
    return [
        {
            "name": a["name"],
            "display_name": a.get("display_name", a["name"]),
            "description": a.get("description", ""),
        }
        for a in load_agents()
    ]
