"""Built-in tool: exec_command -- execute system commands with guardrails.

Used by the agent via the tool-calling loop. Always returns an
approval_required status; actual execution only happens when the
user clicks Approve in the UI.
"""
from __future__ import annotations

import json

from commands.exec_guardrails import validate_and_create_pending, get_allowed_commands

# Ray tool names that the model must never pass to exec_command as shell commands.
_RAY_TOOL_NAMES = {
    "spawn_tasks", "spawn_agent", "web_search", "web_fetch",
    "calculator", "get_current_time",
    "memory_search", "memory_store", "update_user_profile", "document_search",
    "write_file", "read_file", "list_files", "exec_command",
    "list_schedules", "create_schedule", "remove_schedule",
    "grep_files", "glob_files", "ask_user",
}


async def _reroute_to_ray_tool(tool_name: str, original_command: str) -> dict:
    """Use the LLM to extract intended arguments from the garbled command string,
    then call the correct Ray tool directly and return its result."""
    from config import get_default_model, load_yaml
    from llm.responses import _get_async_client, response_output_text
    from tools.registry import execute_tool

    tools_config = load_yaml("tools.yaml")
    tool_def = next(
        (t for t in tools_config.get("tools", []) if t.get("name") == tool_name),
        {},
    )
    schema_str = json.dumps(tool_def.get("parameters", {}), indent=2)
    description = tool_def.get("description", "")
    model = get_default_model(load_yaml("models.yaml"))

    prompt = (
        f"An agent incorrectly called exec_command with this command string:\n"
        f"  {original_command!r}\n\n"
        f"The intended action was to call the `{tool_name}` tool.\n"
        f"Tool description: {description}\n"
        f"Parameter schema:\n{schema_str}\n\n"
        f"Extract the correct arguments from the command string and respond with ONLY "
        f"a valid JSON object matching the schema. If no specific arguments can be "
        f"determined from the command string, respond with {{}}."
    )

    args: dict = {}
    try:
        client = _get_async_client()
        response = await client.responses.create(
            model=model,
            input=[{"role": "user", "content": prompt}],
            stream=False,
        )
        text = response_output_text(response).strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            lines = text.splitlines()
            text = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        args = json.loads(text.strip())
    except Exception:
        pass

    try:
        return await execute_tool(tool_name, args)
    except Exception as exc:
        return {
            "error": f"exec_command was automatically re-routed to `{tool_name}` but the call failed: {exc}",
            "tool_name": tool_name,
            "args_attempted": args,
        }


async def exec_command(command: str) -> dict:
    """Validate a command and request user approval for execution.

    Returns either an error (command not permitted) or an
    approval_required status with a pending ID for the UI to act on.
    """
    # Guard: if the model passes a Ray tool name as a shell command, auto-reroute.
    first_token = (command or "").strip().split()[0] if (command or "").strip() else ""
    if first_token in _RAY_TOOL_NAMES:
        return await _reroute_to_ray_tool(first_token, command)

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
