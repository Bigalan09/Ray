"""Slash command: /hook -- manage webhooks and hooks."""
from __future__ import annotations

import json

from commands.registry import register_command


async def _hook(args_str: str, context: dict) -> dict:
    """Handle /hook subcommands."""
    from hooks.engine import hook_engine
    from hooks.models import SUPPORTED_EVENTS

    args = args_str.strip()

    if not args or args.lower() == "list":
        webhooks = hook_engine.list_webhooks()
        if not webhooks:
            return {"content": "No webhooks configured. Use `/hook add <name> <url> <events>` or the Webhooks panel."}
        lines = ["**Webhooks:**", ""]
        for wh in webhooks:
            status = "enabled" if wh.get("enabled") else "disabled"
            events = ", ".join(wh.get("events", []))
            lines.append(f"  `{wh['name']}` [{status}] {wh['url'][:60]}")
            if events:
                lines.append(f"    Events: {events}")
        return {"content": "\n".join(lines)}

    if args.lower() == "events":
        lines = ["**Supported events:**", ""]
        for ev in SUPPORTED_EVENTS:
            lines.append(f"  `{ev}`")
        return {"content": "\n".join(lines)}

    if args.lower().startswith("log"):
        parts = args.split()
        limit = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 10
        entries = hook_engine.get_log(limit)
        if not entries:
            return {"content": "No hook activity yet."}
        lines = ["**Recent hook activity:**", ""]
        for e in entries:
            status = "ok" if e["success"] else "fail"
            name = e.get("webhook_name") or "hook"
            code = f" ({e['status_code']})" if e.get("status_code") else ""
            lines.append(f"  [{status}] `{e['event']}` -> {name}{code} {e['duration_ms']}ms")
        return {"content": "\n".join(lines)}

    if args.lower().startswith("add "):
        parts = args[4:].strip().split(None, 2)
        if len(parts) < 2:
            return {"content": "Usage: `/hook add <name> <url> [events]`", "error": True}
        name, url = parts[0], parts[1]
        events = [e.strip() for e in parts[2].split(",")] if len(parts) > 2 else SUPPORTED_EVENTS
        wh = hook_engine.add_webhook({"name": name, "url": url, "events": events})
        return {"content": f"Webhook `{wh.name}` added ({len(events)} events)."}

    if args.lower().startswith("remove "):
        name = args[7:].strip()
        if hook_engine.remove_webhook(name):
            return {"content": f"Webhook `{name}` removed."}
        return {"content": f"Webhook `{name}` not found.", "error": True}

    if args.lower().startswith("test "):
        name = args[5:].strip()
        result = await hook_engine.test_webhook(name)
        if "error" in result:
            return {"content": f"Test failed: {result['error']}", "error": True}
        status = "ok" if result.get("success") else "failed"
        code = result.get("status_code", "?")
        return {"content": f"Test `{name}`: {status} (HTTP {code}, {result.get('duration_ms', 0)}ms)"}

    if args.lower() == "reload":
        hook_engine.load_config()
        count = len(hook_engine.list_webhooks())
        return {"content": f"Hooks reloaded. {count} webhook{'s' if count != 1 else ''} configured."}

    return {"content": "Usage: `/hook [list|add|remove|test|log|events|reload]`", "error": True}


def register_hook_commands():
    register_command(
        "hook", _hook,
        "Manage webhooks and hooks",
        "/hook [list|add|remove|test|log|events|reload]",
    )


register_hook_commands()
