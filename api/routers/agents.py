from __future__ import annotations

from fastapi import APIRouter

from agents.registry import get_agent_for_display
from agents.router import route_message

router = APIRouter()


@router.get("/agents")
async def list_agents():
    """Return available agents for the UI."""
    return get_agent_for_display()


@router.post("/agents/route")
async def route(payload: dict):
    """Route a message to the appropriate agent."""
    message = payload.get("message", "")
    current = payload.get("current_agent", "general")
    explicit = payload.get("explicit_agent")
    agent_name = route_message(message, current, explicit)
    return {"agent": agent_name}
