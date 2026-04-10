"""Slash commands API router."""
from __future__ import annotations

from fastapi import APIRouter

# Import to trigger registration
import commands.builtin  # noqa: F401
import commands.file_ops  # noqa: F401
import commands.skills  # noqa: F401
import commands.exec_cmd  # noqa: F401
import commands.hooks_cmd  # noqa: F401
from commands.registry import list_commands, execute_command

router = APIRouter()


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
