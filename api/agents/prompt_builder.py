"""Structured system prompt builder, inspired by OpenClaw's buildAgentSystemPrompt.

Assembles workspace context files in a defined order and adds standard
sections for workspace and runtime information.

File loading order (OpenClaw convention):
  AGENTS.md     → 10  (operating instructions)
  SOUL.md       → 20  (personality, principles, boundaries)
  IDENTITY.md   → 30  (name, vibe, emoji)
  USER.md       → 40  (about the human)
  TOOLS.md      → 50  (local tool notes)
  MEMORY.md     → 70  (curated long-term memory)
  memory/today  → 75  (daily log excerpt)
"""
from __future__ import annotations

import logging
from datetime import date

from config import settings

log = logging.getLogger(__name__)

# Large files are trimmed to this limit to keep the prompt lean
MAX_FILE_CHARS = 4000


def load_workspace_file(filename: str) -> str:
    """Load a file from Ray's workspace directory."""
    path = settings.workspace_dir / filename
    if path.exists():
        text = path.read_text(encoding="utf-8").strip()
        if text:
            return text
    return ""


def _trimmed(content: str, label: str = "") -> str:
    """Trim content if it exceeds MAX_FILE_CHARS."""
    if len(content) <= MAX_FILE_CHARS:
        return content
    trimmed = content[:MAX_FILE_CHARS]
    return f"{trimmed}\n\n_(truncated {label}, {len(content)} chars total)_"


def build_system_prompt(
    agent_prompt: str,
    agent_name: str = "general",
    model: str = "",
    bootstrap_mode: bool = False,
    tools: list[dict] | None = None,
    injected_memories: list[dict] | None = None,
    injected_documents: list[dict] | None = None,
) -> str:
    """Build the full system prompt from workspace files and agent config.

    In bootstrap mode, the BOOTSTRAP.md content replaces the normal prompt.
    """
    if bootstrap_mode:
        return _build_bootstrap_prompt()

    sections: list[str] = []

    # --- Workspace context files in OpenClaw order ---

    for filename, label in [
        ("AGENTS.md", "operating instructions"),
        ("SOUL.md", "personality"),
        ("IDENTITY.md", "identity"),
    ]:
        content = load_workspace_file(filename)
        if content:
            sections.append(_trimmed(content, label))

    user = load_workspace_file("USER.md") or load_workspace_file("ME.md")
    if user:
        sections.append(_trimmed(user, "user profile"))

    tool_notes = load_workspace_file("TOOLS.md")
    if tool_notes:
        sections.append(_trimmed(tool_notes, "tool notes"))

    # --- Memory (dynamic, below cache line) ---
    memory = load_workspace_file("MEMORY.md")
    if memory and len(memory) > 50:
        sections.append(f"## Long-Term Memory\n\n{_trimmed(memory, 'memory')}")

    # Daily memory log (today + yesterday)
    today = date.today()
    for d in [today, today.fromordinal(today.toordinal() - 1)]:
        daily = load_workspace_file(f"memory/{d.isoformat()}.md")
        if daily:
            sections.append(f"## Memory: {d.isoformat()}\n\n{_trimmed(daily, 'daily log')}")

    # --- Proactive memory injection (semantic search results for this turn) ---
    if injected_memories:
        snippets = "\n".join(
            f"- {m['content']}" for m in injected_memories[:4] if m.get("content")
        )
        if snippets:
            sections.append(f"## Relevant Memory\n\n{snippets}")

    # --- Proactive document injection (RAG chunks relevant to this turn) ---
    if injected_documents:
        doc_snippets = []
        for chunk in injected_documents[:5]:
            source = chunk.get("metadata", {}).get("source", "document")
            content = chunk.get("document", chunk.get("content", ""))
            if content:
                doc_snippets.append(f"**[{source}]**\n{content[:600]}")
        if doc_snippets:
            sections.append(
                "## Relevant Documents\n\n"
                "The following excerpts from uploaded documents may be relevant:\n\n"
                + "\n\n".join(doc_snippets)
            )

    # --- Agent-specific prompt ---
    if agent_prompt:
        sections.append(agent_prompt.strip())

    # --- Capabilities (tools, skills, commands) ---
    capabilities = _capabilities_section(tools)
    if capabilities:
        sections.append(capabilities)

    # --- Workspace ---
    sections.append(_workspace_section())

    # --- Runtime ---
    sections.append(_runtime_section(agent_name, model))

    return "\n\n---\n\n".join(s for s in sections if s)


def build_workspace_context() -> str:
    """Build condensed workspace context for injection into non-system-message paths.

    Includes identity files, memory, workspace instructions, and capabilities.
    """
    sections: list[str] = []

    for filename, label in [
        ("AGENTS.md", "operating instructions"),
        ("SOUL.md", "personality"),
        ("IDENTITY.md", "identity"),
    ]:
        content = load_workspace_file(filename)
        if content:
            sections.append(_trimmed(content, label))

    user = load_workspace_file("USER.md") or load_workspace_file("ME.md")
    if user:
        sections.append(_trimmed(user, "user profile"))

    memory = load_workspace_file("MEMORY.md")
    if memory and len(memory) > 50:
        sections.append(f"## Long-Term Memory\n\n{_trimmed(memory, 'memory')}")

    today = date.today()
    for d in [today, today.fromordinal(today.toordinal() - 1)]:
        daily = load_workspace_file(f"memory/{d.isoformat()}.md")
        if daily:
            sections.append(f"## Daily Log: {d.isoformat()}\n\n{_trimmed(daily, 'daily log')}")

    # Include capabilities for any path that cannot rely on a system prompt
    capabilities = _capabilities_section()
    if capabilities:
        sections.append(capabilities)

    sections.append(_workspace_section())

    return "\n\n---\n\n".join(s for s in sections if s)


def _build_bootstrap_prompt() -> str:
    """Load and prepare the bootstrap onboarding prompt."""
    bootstrap = load_workspace_file("BOOTSTRAP.md")
    if not bootstrap:
        return _default_bootstrap_prompt()

    existing_parts = []
    for filename in ("SOUL.md", "USER.md"):
        content = load_workspace_file(filename)
        if content and len(content) > 50:
            existing_parts.append(f"### Existing {filename}\n\n{content}")

    existing = "\n\n".join(existing_parts) if existing_parts else "(No existing identity files found.)"
    return bootstrap.replace("{existing_identity}", existing)


def _default_bootstrap_prompt() -> str:
    return (
        "You are Ray, a personal AI assistant starting for the first time. "
        "Ask the user about themselves and how they want you to work. "
        "One question at a time. When done, tell them to type /bootstrap done."
    )


def _capabilities_section(tools: list[dict] | None = None) -> str:
    """Build a section listing all available capabilities.

    Includes function-calling tools (built-in + MCP), skills, and
    slash commands so the agent knows exactly what it can do.
    """
    lines: list[str] = ["## Available Capabilities"]

    # --- Function-calling tools ---
    if tools:
        builtin = []
        mcp = []
        for t in tools:
            fn = t.get("function", {})
            name = fn.get("name", "")
            desc = fn.get("description", "").split(".")[0]  # first sentence
            if name.startswith("mcp__"):
                mcp.append((name, desc))
            else:
                builtin.append((name, desc))

        if builtin:
            lines.append("\n### Tools")
            lines.append("You can call these tools directly (they are available as functions):")
            for name, desc in builtin:
                lines.append(f"- **{name}**: {desc}")

        if mcp:
            lines.append("\n### MCP Tools")
            lines.append("External tools from connected MCP servers:")
            for name, desc in mcp:
                # mcp__filesystem__read_file -> filesystem / read_file
                parts = name[5:].split("__", 1)
                display = f"{parts[0]} / {parts[1]}" if len(parts) == 2 else name
                lines.append(f"- **{display}**: {desc}")

    # --- Skills ---
    try:
        from config import load_yaml
        skills_config = load_yaml("skills.yaml")
        skill_list = skills_config.get("skills", [])
        if skill_list:
            lines.append("\n### Skills")
            lines.append("The user can invoke these with `/skill <name> <input>`:")
            for s in skill_list:
                lines.append(f"- **{s['name']}**: {s.get('description', '')}")
    except Exception:
        log.debug("Failed to load skills for capabilities section", exc_info=True)

    # --- Slash commands ---
    try:
        from commands.registry import list_commands

        commands = list_commands()
        if commands:
            lines.append("\n### Slash Commands")
            lines.append("The user can type these directly (handled server-side, no LLM call):")
            for cmd in commands:
                lines.append(f"- **{cmd['name']}**: {cmd['description']}")
    except Exception:
        log.debug("Failed to load commands for capabilities section", exc_info=True)

    # Only return if we have content beyond the heading
    if len(lines) <= 1:
        return ""
    return "\n".join(lines)


def _workspace_section() -> str:
    return """## Workspace

Your home is /workspace. Everything you need is here.
- /workspace (writable). Identity, memory, tool notes, databases.
- /config (read-only). YAML app configs.
- Use /file commands to manage workspace files.
- Daily memory: write to memory/YYYY-MM-DD.md. Curated: MEMORY.md."""


def _runtime_section(agent_name: str, model: str) -> str:
    model_str = model or "default"
    return f"## Runtime\n\nAgent: {agent_name} | Model: {model_str} | Channel: web"
