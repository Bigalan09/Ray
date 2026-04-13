"""Built-in slash commands."""
from __future__ import annotations

import json

from commands.registry import register_command


async def _help(args_str: str, context: dict) -> dict:
    from commands.registry import list_commands
    cmds = list_commands()
    lines = ["**Available commands:**\n"]
    for cmd in cmds:
        lines.append(f"- `{cmd['usage']}` — {cmd['description']}")
    return {"content": "\n".join(lines)}


async def _new(args_str: str, context: dict) -> dict:
    return {"content": "New session started.", "action": "clear"}


async def _clear(args_str: str, context: dict) -> dict:
    if args_str.strip().lower() == "all":
        from memory.conversation import delete_all_conversations
        count = delete_all_conversations()
        return {"content": f"Deleted {count} session{'s' if count != 1 else ''}.", "action": "clear"}
    return {"content": "Session cleared.", "action": "clear"}


async def _compact(args_str: str, context: dict) -> dict:
    """Summarise the conversation so far to reduce token usage."""
    conv_id = context.get("conversation_id")
    if not conv_id:
        return {"content": "No active conversation to compact.", "error": True}

    instructions = args_str.strip() if args_str.strip() else "Summarise the conversation so far in a few bullet points. Keep key decisions, action items, and context."

    return {
        "type": "redirect",
        "message": (
            f"The user wants to compact this conversation. {instructions}\n\n"
            "Provide a concise summary of what we have discussed so far, "
            "including key decisions, outstanding items, and important context. "
            "This summary will replace the conversation history to save tokens."
        ),
        "agent": "general",
        "content": "Compacting conversation...",
    }


async def _status(args_str: str, context: dict) -> dict:
    from tools.mcp.manager import get_server_status
    from tasks.scheduler import get_scheduled_jobs
    from tasks.store import list_tasks

    mcp = get_server_status()
    jobs = get_scheduled_jobs()
    tasks = list_tasks(limit=5)

    lines = ["**System status:**\n"]
    lines.append(f"- MCP servers: {len(mcp)} configured")
    running = sum(1 for s in mcp if s.get("running"))
    if running:
        lines.append(f"  - {running} running")
    lines.append(f"- Scheduled jobs: {len(jobs)}")
    lines.append(f"- Recent tasks: {len(tasks)}")
    for t in tasks[:3]:
        lines.append(f"  - [{t['status']}] {t['prompt'][:60]}")
    return {"content": "\n".join(lines)}



async def _tool(args_str: str, context: dict) -> dict:
    from tools.registry import execute_tool
    from config import load_yaml

    if not args_str or args_str.strip().lower() == "list":
        tools_config = load_yaml("tools.yaml")
        tools_list = tools_config.get("tools", [])
        lines = ["**Available tools:**\n"]
        for t in tools_list:
            enabled = t.get("enabled", True)
            marker = " *(disabled)*" if not enabled else ""
            desc = t.get("description", "").strip()
            # First sentence only
            dot = desc.find(". ")
            if dot != -1:
                desc = desc[:dot + 1]
            lines.append(f"- `{t['name']}` — {desc}{marker}")
        return {"content": "\n".join(lines)}

    parts = args_str.strip().split(None, 1)
    tool_name = parts[0]
    args_json = parts[1] if len(parts) > 1 else "{}"

    try:
            arguments = json.loads(args_json)
    except json.JSONDecodeError:
        return {"content": f"Invalid JSON arguments: {args_json}", "error": True}

    result = await execute_tool(tool_name, arguments)
    if "error" in result:
        return {"content": f"Tool error: {result['error']}", "error": True}

    formatted = json.dumps(result, indent=2)
    return {"content": f"**{tool_name}** result:\n```json\n{formatted}\n```", "data": result}


async def _task(args_str: str, context: dict) -> dict:
    from tasks.store import create_task, list_tasks, get_task
    from tasks.runner import run_agent_task
    import asyncio

    args = args_str.strip()

    if not args or args.lower() == "list":
        tasks = list_tasks(limit=10)
        if not tasks:
            return {"content": "No tasks found."}
        lines = ["**Recent tasks:**\n"]
        for t in tasks:
            lines.append(f"- `{t['id'][:8]}` [{t['status']}] {t['prompt'][:60]}")
        return {"content": "\n".join(lines)}

    if args.lower().startswith("status"):
        task_id = args[6:].strip()
        if not task_id:
            return await _task("list", context)
        task = get_task(task_id)
        if not task:
            return {"content": f"Task not found: {task_id}", "error": True}
        lines = [
            f"**Task {task_id[:8]}**",
            f"Status: {task['status']}",
            f"Agent: {task.get('agent', 'general')}",
            f"Prompt: {task['prompt'][:200]}",
        ]
        if task.get("result"):
            lines.append(f"Result: {task['result'][:500]}")
        if task.get("error"):
            lines.append(f"Error: {task['error']}")
        return {"content": "\n".join(lines)}

    if args.lower().startswith("cancel "):
        task_id = args[7:].strip()
        from tasks.store import update_task_status, TaskStatus
        update_task_status(task_id, TaskStatus.CANCELLED)
        return {"content": f"Task `{task_id[:8]}` cancelled."}

    # Create and run a new task
    task = create_task(task_type="background", prompt=args, agent="general")
    asyncio.create_task(run_agent_task(task["id"]))
    return {
        "content": f"Task created: `{task['id'][:8]}` (running in background)",
        "data": {"task_id": task["id"]},
    }


def _extract_user_name(user_md: str) -> str:
    """Try to extract the user's name from USER.md content."""
    import re
    for pattern in [r"\*\*Name:\*\*\s*(.+)", r"Name:\s*(.+)", r"^#.*?[-–—]\s*(.+)"]:
        m = re.search(pattern, user_md, re.MULTILINE)
        if m:
            name = m.group(1).strip().rstrip(".")
            if name and len(name) < 30:
                return name
    return ""


async def _bootstrap(args_str: str, context: dict) -> dict:
    from bootstrap import is_bootstrapped, mark_bootstrapped, reset_bootstrap

    args = args_str.strip().lower()

    if args == "status":
        return {"content": f"Bootstrap: {'complete' if is_bootstrapped() else 'pending'}"}

    if args == "reset":
        reset_bootstrap()
        return {"content": "Bootstrap reset. The next message will start the onboarding conversation.", "action": "clear"}

    if args == "done":
        # Look for bootstrap markers in the conversation history
        conv_id = context.get("conversation_id")
        if conv_id:
            from memory.conversation import get_conversation
            conv = get_conversation(conv_id)
            if conv:
                # Search all assistant messages for the markers
                for msg in reversed(conv.get("messages", [])):
                    if msg.get("role") != "assistant":
                        continue
                    content = msg.get("content", "")
                    if "IDENTITY_START" in content:
                        import re
                        def _extract(start: str, end: str) -> str:
                            m = re.search(f"{start}[\\s\\n]*(.*?)[\\s\\n]*{end}", content, re.DOTALL)
                            return m.group(1).strip() if m else ""

                        identity = _extract("---IDENTITY_START---", "---IDENTITY_END---")
                        soul = _extract("---SOUL_START---", "---SOUL_END---")
                        user = _extract("---USER_START---", "---USER_END---")

                        if identity:
                            mark_bootstrapped(identity, soul, user)
                            saved = ["IDENTITY.md"]
                            if soul:
                                saved.append("SOUL.md")
                            if user:
                                saved.append("USER.md")
                            name = _extract_user_name(user)
                            greeting = f"Hi {name}, how can I help?" if name else "Hi, how can I help?"
                            return {"content": f"Updated {', '.join(saved)}.\n\n{greeting}"}

        # No markers found in conversation. Ask the agent to generate them.
        return {
            "type": "redirect",
            "bootstrap_finalize": True,
            "message": (
                "The user typed /bootstrap done. Based on our conversation, generate three markdown files now. "
                "Use these EXACT markers (on their own lines, no extra formatting):\n\n"
                "---IDENTITY_START---\n(IDENTITY.md content)\n---IDENTITY_END---\n\n"
                "---SOUL_START---\n(SOUL.md content)\n---SOUL_END---\n\n"
                "---USER_START---\n(USER.md content)\n---USER_END---\n\n"
                "Be thorough. Use markdown headers. Base everything on what we discussed. "
                "Output ONLY the markers and their content, nothing else."
            ),
            "agent": "general",
            "content": "Generating identity files...",
        }

    return {"content": "Usage: `/bootstrap done` | `/bootstrap reset` | `/bootstrap status`"}


async def _schedule(args_str: str, context: dict) -> dict:
    from tasks.scheduler import get_scheduled_jobs, add_schedule, remove_schedule, is_valid_cron

    args = args_str.strip()

    if not args or args.lower() == "list":
        jobs = get_scheduled_jobs()
        if not jobs:
            return {"content": "No scheduled tasks. Use `/schedule <cron> <prompt>` to create one."}
        lines = ["**Scheduled tasks:**\n"]
        for j in jobs:
            lines.append(f"- `{j['name']}` — next: {j.get('next_run', 'unknown')}")
        return {"content": "\n".join(lines)}

    if args.lower().startswith("remove "):
        name = args[7:].strip()
        result = remove_schedule(name)
        if "error" in result:
            return {"content": f"Error: {result['error']}", "error": True}
        return {"content": f"Schedule `{result['removed']}` removed."}

    parts = args.split(None, 5)
    if len(parts) >= 6:
        cron_expr = " ".join(parts[:5])
        prompt = parts[5]
        if is_valid_cron(cron_expr):
            name = prompt[:30].lower().replace(" ", "_").replace(".", "")
            result = add_schedule(name, cron_expr, prompt)
            if "error" in result:
                return {"content": f"Schedule error: {result['error']}", "error": True}
            return {"content": f"Scheduled `{result['name']}` with cron `{cron_expr}`.\nNext run: {result['next_run']}"}

    # Natural language: redirect to agent for cron parsing
    return {
        "type": "redirect",
        "message": (
            f"The user wants to create a scheduled task: \"{args}\"\n\n"
            "Parse this into a cron expression and a task prompt. Respond with EXACTLY this format:\n"
            "SCHEDULE_CRON: <5-field cron expression>\n"
            "SCHEDULE_NAME: <short snake_case name>\n"
            "SCHEDULE_PROMPT: <the full task prompt>\n\n"
            "Cron format: minute hour day-of-month month day-of-week\n"
            "Examples:\n"
            "- Daily at 8am: 0 8 * * *\n"
            "- Weekdays at 8:30am: 30 8 * * 1-5\n"
            "- Every Monday at 9am: 0 9 * * 1\n"
            "- Every hour: 0 * * * *\n"
            "- Every 15 minutes: */15 * * * *\n\n"
            "IMPORTANT: The cron expression MUST be exactly 5 space-separated fields "
            "using only numbers, *, /, -, and commas. "
            "Days of week: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat. "
            "Do NOT include English words in the cron expression."
        ),
        "agent": "general",
        "content": "Parsing schedule...",
    }


async def _agent(args_str: str, context: dict) -> dict:
    """Switch to a named agent or list available agents."""
    from agents.registry import get_agent_for_display

    args = args_str.strip().lower()

    if not args or args == "list":
        agents = get_agent_for_display()
        lines = ["**Available agents:**\n"]
        for a in agents:
            lines.append(f"- `{a['name']}` — {a.get('description', '')}")
        lines.append("\nUse `/agent <name>` to switch.")
        return {"content": "\n".join(lines)}

    agents = get_agent_for_display()
    agent_info = next((a for a in agents if a["name"] == args), None)
    if not agent_info:
        names = ", ".join(f"`{a['name']}`" for a in agents)
        return {"content": f"Unknown agent: `{args}`. Available: {names}", "error": True}

    display = agent_info.get("display_name", agent_info["name"])
    desc = agent_info.get("description", "")
    intro = f"respond as {display}. {desc}".rstrip() if desc else f"respond as {display}."
    return {
        "type": "redirect",
        "agent": args,
        "message": f"[switched to {args} agent] Hello — {intro} What would you like to do?",
        "content": f"Switched to **{display}** agent.",
    }


def register_builtin_commands():
    """Register all built-in commands. Called at import time."""
    register_command("help", _help, "List available commands", "/help")
    register_command("new", _new, "Start a new session", "/new")
    register_command("clear", _clear, "Clear session, or /clear all to delete all sessions", "/clear [all]")
    register_command("compact", _compact, "Summarise conversation to save tokens", "/compact [instructions]")
    register_command("status", _status, "Show system status", "/status")
    register_command("tool", _tool, "Execute a tool or list tools", "/tool [name] [json_args]")
    register_command("task", _task, "Create or manage background tasks", "/task [prompt] | status [id] | cancel [id]")
    register_command("schedule", _schedule, "Create or manage scheduled tasks", "/schedule [cron] [prompt] | list | remove [name]")
    register_command("agent", _agent, "Switch agent or list available agents", "/agent [name]")
    register_command("bootstrap", _bootstrap, "Manage first-run onboarding", "/bootstrap done|reset|status")


register_builtin_commands()
