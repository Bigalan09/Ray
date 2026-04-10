"""Local action bridge for model outputs that imply local side effects.

This module scans a plain assistant response for action intents and executes
them locally when explicit tool calling is unavailable. Results are appended
as system messages to the conversation.

Detected patterns:
- Task creation hints ("I'll create a task", "running in background", etc.)
- Memory storage ("I'll remember that", "noted", storing preferences)
- Schedule creation ("I'll schedule that", "set up a daily", etc.)
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)


async def process_local_actions(response_text: str, messages: list[dict], conversation_id: str | None) -> list[str]:
    """Scan the agent response for local action intents and execute them.

    Returns a list of action descriptions (for logging/display).
    """
    actions_taken = []

    # Schedule creation: if the agent output contains SCHEDULE_CRON markers
    if "SCHEDULE_CRON:" in response_text:
        result = _try_create_schedule(response_text)
        if result:
            actions_taken.append(f"Created schedule: {result}")

    # Memory storage: if the agent says it will remember something
    if _wants_to_remember(response_text):
        await _store_memory(response_text, messages)
        actions_taken.append("Stored memory")

    return actions_taken


def _try_create_schedule(text: str) -> str | None:
    """Parse SCHEDULE_CRON/SCHEDULE_NAME/SCHEDULE_PROMPT markers and create a schedule."""
    try:
        cron_match = re.search(r"SCHEDULE_CRON:\s*(.+)", text)
        name_match = re.search(r"SCHEDULE_NAME:\s*(.+)", text)
        prompt_match = re.search(r"SCHEDULE_PROMPT:\s*(.+)", text)

        if not cron_match or not prompt_match:
            return None

        cron = cron_match.group(1).strip()
        name = name_match.group(1).strip() if name_match else "scheduled_task"
        prompt = prompt_match.group(1).strip()

        from tasks.scheduler import add_schedule
        result = add_schedule(name, cron, prompt)

        if "error" in result:
            log.warning("Failed to create schedule: %s", result["error"])
            return None

        log.info("Auto-created schedule '%s' with cron '%s'", name, cron)
        return name
    except Exception:
        log.warning("Failed to parse schedule from response", exc_info=True)
        return None


_REMEMBER_PATTERNS = [
    re.compile(p) for p in [
        r"i.ll remember",
        r"noted.{0,20}(preference|that|this)",
        r"storing.{0,20}(in memory|for later)",
        r"i.ve (noted|saved|recorded)",
        r"updating.{0,20}(memory|profile|notes)",
    ]
]


def _wants_to_remember(text: str) -> bool:
    """Check if the agent indicated it wants to store something in memory."""
    lower = text.lower()
    return any(p.search(lower) for p in _REMEMBER_PATTERNS)


async def _store_memory(response_text: str, messages: list[dict]) -> None:
    """Extract what the agent wants to remember and store it."""
    try:
        from memory.store import memory_store
        # Store a summary of the exchange
        last_user = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                last_user = content if isinstance(content, str) else str(content)
                break
        if last_user:
            await memory_store(
                content=f"User said: {last_user[:200]}. Ray noted: {response_text[:200]}",
                tags=["auto-captured"],
                source="agent",
            )
    except Exception:
        log.warning("Failed to auto-store memory", exc_info=True)
