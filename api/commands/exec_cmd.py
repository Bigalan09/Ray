"""Slash command: /exec -- execute system commands with guardrails."""
from __future__ import annotations

from commands.registry import register_command
from commands.exec_guardrails import validate_and_create_pending, get_allowed_commands, load_exec_config


async def _exec(args_str: str, context: dict) -> dict:
    """Handle /exec <command> with guardrail validation and confirmation."""
    args = args_str.strip()

    if not args or args.lower() == "list":
        return _list_allowed()

    result, pending = validate_and_create_pending(args)

    if not result.allowed:
        lines = ["**Command not permitted**", "", result.error or "Unknown error.", ""]
        allowed = get_allowed_commands()
        if allowed:
            lines.append("**Allowed commands:**")
            for cmd in allowed:
                lines.append(f"  `{cmd['summary']}`  {cmd['description']}")
        return {"content": "\n".join(lines), "error": True}

    full_command = " ".join(result.tokens)
    return {
        "type": "exec_confirm",
        "pending_id": pending.id,
        "full_command": full_command,
        "description": result.rule.get("description", ""),
        "timeout": result.timeout,
        "working_dir": result.working_dir,
        "content": (
            f"**Execute command?**\n\n"
            f"`{full_command}`\n\n"
            f"Working directory: `{result.working_dir}`\n"
            f"Timeout: {result.timeout}s\n"
            f"Rule: {result.rule.get('description', 'allowed')}"
        ),
    }


def _list_allowed() -> dict:
    """Show all commands permitted by the exec guardrails."""
    config = load_exec_config()
    if not config.get("enabled", False):
        return {"content": "Exec is currently disabled.", "error": True}

    allowed = get_allowed_commands()
    if not allowed:
        return {"content": "No commands are permitted. The exec allowlist is empty."}

    lines = ["**Allowed exec commands:**", ""]
    for cmd in allowed:
        lines.append(f"  `{cmd['summary']}`  {cmd['description']}")
    lines.append("")
    lines.append("Usage: `/exec <command>`")
    return {"content": "\n".join(lines)}


def register_exec_commands():
    register_command(
        "exec", _exec,
        "Execute a system command (requires approval)",
        "/exec <command> | list",
    )


register_exec_commands()
