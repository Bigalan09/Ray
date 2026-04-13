"""Slash command registry. Same pattern as tools/registry.py."""
from __future__ import annotations

import re
from typing import Callable, Awaitable

_COMMAND_RE = re.compile(r"^/(\S+)\s*(.*)", re.DOTALL)


class CommandDef:
    """Metadata for a registered command."""

    def __init__(
        self,
        name: str,
        handler: Callable[..., Awaitable[dict]],
        description: str,
        usage: str,
    ):
        self.name = name
        self.handler = handler
        self.description = description
        self.usage = usage


COMMANDS: dict[str, CommandDef] = {}


def ensure_commands_registered() -> None:
    """Load built-in commands on demand."""
    from commands import register_all_commands

    register_all_commands()


def register_command(
    name: str,
    handler: Callable[..., Awaitable[dict]],
    description: str,
    usage: str = "",
):
    """Register a slash command handler."""
    COMMANDS[name] = CommandDef(name, handler, description, usage or f"/{name}")


def parse_command(message: str) -> tuple[str, str] | None:
    """If message starts with /, return (command_name, args_string). Else None."""
    m = _COMMAND_RE.match(message.strip())
    if m:
        return m.group(1).lower(), m.group(2).strip()
    return None


async def execute_command(name: str, args_str: str, context: dict | None = None) -> dict:
    """Execute a registered command. Returns a result dict."""
    ensure_commands_registered()
    cmd = COMMANDS.get(name)
    if not cmd:
        return {
            "type": "command_result",
            "command": f"/{name}",
            "content": f"Unknown command: /{name}. Type /help for available commands.",
            "error": True,
        }
    try:
        from hooks.engine import hook_engine
        cancel = await hook_engine.pre(f"command:{name}", {"command": name, "args": args_str})
        if cancel and cancel.get("cancel"):
            return {
                "type": "command_result",
                "command": f"/{name}",
                "content": f"Blocked by hook: {cancel.get('reason', 'pre-hook cancelled')}",
                "error": True,
            }
        result = await cmd.handler(args_str, context or {})
        result.setdefault("type", "command_result")
        result.setdefault("command", f"/{name}")
        import asyncio
        asyncio.create_task(hook_engine.emit("command_executed", {
            "command": name, "args": args_str, "error": result.get("error", False),
        }))
        asyncio.create_task(hook_engine.emit("command", {
            "command": name, "args": args_str, "error": result.get("error", False),
        }))
        asyncio.create_task(hook_engine.post(f"command:{name}", {
            "command": name, "args": args_str, "result": result.get("content", "")[:200],
        }))
        return result
    except Exception as exc:
        return {
            "type": "command_result",
            "command": f"/{name}",
            "content": f"Command error: {exc}",
            "error": True,
        }


def list_commands() -> list[dict]:
    """Return all registered commands for API/autocomplete."""
    ensure_commands_registered()
    return [
        {"name": f"/{c.name}", "description": c.description, "usage": c.usage}
        for c in COMMANDS.values()
    ]
