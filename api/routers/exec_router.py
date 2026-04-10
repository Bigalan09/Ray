"""Exec approve/deny endpoints."""
from __future__ import annotations

import logging

from fastapi import APIRouter
from pydantic import BaseModel

from commands.exec_pending import get_pending, remove_pending
from commands.exec_runner import run_command

log = logging.getLogger(__name__)

router = APIRouter()


class ExecRequest(BaseModel):
    pending_id: str


_EXPIRED_RESPONSE = {
    "type": "command_result",
    "command": "/exec",
    "content": "Confirmation expired or not found. Please run the command again.",
    "error": True,
    "expired": True,
}


@router.post("/exec/approve")
async def approve_exec(req: ExecRequest):
    """Approve and execute a pending command.

    If the agent loop is waiting (tool path), signals the event so it
    resumes with the result. Otherwise (slash command path), runs the
    command and returns the result directly.
    """
    pending = get_pending(req.pending_id)
    if pending is None:
        return _EXPIRED_RESPONSE

    full_command = " ".join(pending.tokens)
    log.info("Exec approved: %s", full_command)

    from hooks.engine import hook_engine
    import asyncio
    asyncio.create_task(hook_engine.emit("exec_approved", {
        "pending_id": req.pending_id, "command": full_command,
    }))

    result = await run_command(
        tokens=pending.tokens,
        timeout=pending.timeout,
        working_dir=pending.working_dir,
        max_output=pending.max_output,
    )

    result_dict = {
        "exit_code": result.exit_code,
        "stdout": result.stdout,
        "stderr": result.stderr,
        "timed_out": result.timed_out,
        "truncated": result.truncated,
        "duration_ms": result.duration_ms,
    }

    # Signal the agent loop if it is waiting, then clean up.
    pending.approved = True
    pending.exec_result = result_dict
    pending.resolved.set()
    # Delay removal briefly so the agent loop can read the result.
    import asyncio
    asyncio.get_event_loop().call_later(2.0, remove_pending, req.pending_id)

    # Also return the result for the slash command path (direct response).
    status = "timed out" if result.timed_out else f"exit {result.exit_code}"
    lines = [f"**`{full_command}`** ({status}, {result.duration_ms}ms)"]

    output = result.stdout.strip()
    if output:
        lines.append(f"```\n{output}\n```")

    if result.stderr.strip():
        lines.append(f"**stderr:**\n```\n{result.stderr.strip()}\n```")

    if result.truncated:
        lines.append("*(output was truncated)*")

    return {
        "type": "command_result",
        "command": "/exec",
        "content": "\n".join(lines),
        "data": result_dict,
    }


@router.post("/exec/deny")
async def deny_exec(req: ExecRequest):
    """Deny a pending command execution."""
    pending = get_pending(req.pending_id)
    if pending is None:
        return _EXPIRED_RESPONSE

    full_command = " ".join(pending.tokens)
    log.info("Exec denied: %s", full_command)

    asyncio.create_task(hook_engine.emit("exec_denied", {
        "pending_id": req.pending_id, "command": full_command,
    }))

    # Signal the agent loop if it is waiting.
    pending.approved = False
    try:
        pending.resolved.set()
    except Exception:
        pass

    remove_pending(req.pending_id)

    return {
        "type": "command_result",
        "command": "/exec",
        "content": f"Command `{full_command}` was denied.",
    }
