"""Built-in tool: exec_command -- execute system commands with guardrails.

Used by the agent via the tool-calling loop. Always returns an
approval_required status; actual execution only happens when the
user clicks Approve in the UI.
"""
from __future__ import annotations

from commands.exec_guardrails import validate_and_create_pending, get_allowed_commands


async def exec_command(command: str) -> dict:
    """Validate a command and request user approval for execution.

    Returns either an error (command not permitted) or an
    approval_required status with a pending ID for the UI to act on.
    """
    result, pending = validate_and_create_pending(command)

    if not result.allowed:
        allowed = get_allowed_commands()
        return {
            "error": result.error or "Command not permitted.",
            "allowed_commands": [c["summary"] for c in allowed],
        }

    full_command = " ".join(result.tokens)
    return {
        "status": "approval_required",
        "pending_id": pending.id,
        "command": full_command,
        "description": result.rule.get("description", ""),
        "timeout": result.timeout,
        "message": (
            f"I would like to run `{full_command}`. "
            "This command requires your approval before it can execute. "
            "Please use the Approve button above."
        ),
    }
