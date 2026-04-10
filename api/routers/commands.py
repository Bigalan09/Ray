"""Slash commands API router."""
from __future__ import annotations

from fastapi import APIRouter

from commands import register_all_commands
from commands.registry import list_commands, execute_command

router = APIRouter()
register_all_commands()


@router.get("/commands")
async def get_commands():
    """Return all available slash commands (for UI autocomplete)."""
    return list_commands()


@router.post("/commands/execute")
async def run_command(request_body: dict):
    """Execute a slash command directly."""
    name = request_body.get("command", "").lstrip("/")
    args = request_body.get("args", "")
    context = request_body.get("context", {})
    return await execute_command(name, args, context)
