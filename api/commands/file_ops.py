"""Workspace-scoped file operations for slash commands."""
from __future__ import annotations

import glob
import os
from datetime import datetime, timezone
from pathlib import Path

from config import settings
from commands.registry import register_command


def _workspace_root() -> Path:
    return settings.workspace_dir


def _resolve_safe(user_path: str) -> Path | None:
    """Resolve a user-provided path within the workspace. Returns None if it escapes."""
    root = _workspace_root().resolve()
    target = (root / user_path).resolve()
    if not str(target).startswith(str(root)):
        return None
    return target


async def _file(args_str: str, context: dict) -> dict:
    args = args_str.strip()
    if not args:
        return {"content": "Usage: `/file read <path>`, `/file write <name> <content>`, `/file list [dir]`, `/file search <pattern>`"}

    parts = args.split(None, 1)
    subcommand = parts[0].lower()
    rest = parts[1] if len(parts) > 1 else ""

    if subcommand == "read":
        return await _file_read(rest)
    elif subcommand == "write":
        return await _file_write(rest)
    elif subcommand == "list":
        return await _file_list(rest)
    elif subcommand == "search":
        return await _file_search(rest)
    else:
        return {"content": f"Unknown file subcommand: {subcommand}. Use read, write, list, or search.", "error": True}


async def _file_write(args_str: str) -> dict:
    """Write content to a file in the data directory."""
    if not args_str:
        return {"content": "Usage: `/file write <filename> <content>`", "error": True}

    parts = args_str.split(None, 1)
    filename = parts[0]
    content = parts[1] if len(parts) > 1 else ""

    if not content:
        return {"content": f"No content provided for {filename}.", "error": True}

    # Write to workspace
    ws = settings.workspace_dir
    target = (ws / filename).resolve()
    if not str(target).startswith(str(ws.resolve())):
        return {"content": "Access denied: path is outside data directory.", "error": True}

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"content": f"Written to `{filename}` ({len(content)} bytes)."}
    except Exception as exc:
        return {"content": f"Error writing file: {exc}", "error": True}


async def _file_read(path_str: str) -> dict:
    if not path_str:
        return {"content": "Usage: `/file read <path>`", "error": True}

    target = _resolve_safe(path_str)
    if target is None:
        return {"content": "Access denied: path is outside workspace.", "error": True}

    if not target.exists():
        return {"content": f"File not found: {path_str}", "error": True}

    if target.is_dir():
        return {"content": f"{path_str} is a directory. Use `/file list {path_str}` instead.", "error": True}

    try:
        size = target.stat().st_size
        if size > 100_000:
            return {"content": f"File too large ({size:,} bytes). Maximum is 100KB.", "error": True}
        content = target.read_text(errors="replace")
        ext = target.suffix.lstrip(".")
        lang = ext if ext else "text"
        return {"content": f"**{path_str}** ({size:,} bytes):\n```{lang}\n{content}\n```"}
    except Exception as exc:
        return {"content": f"Error reading file: {exc}", "error": True}


async def _file_list(dir_str: str) -> dict:
    target = _resolve_safe(dir_str or ".")
    if target is None:
        return {"content": "Access denied: path is outside workspace.", "error": True}

    if not target.exists():
        return {"content": f"Directory not found: {dir_str or '.'}", "error": True}

    if not target.is_dir():
        return {"content": f"{dir_str} is a file, not a directory.", "error": True}

    entries = []
    try:
        for item in sorted(target.iterdir()):
            stat = item.stat()
            kind = "dir" if item.is_dir() else "file"
            size = stat.st_size if item.is_file() else 0
            modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            entries.append(f"  {'[dir]' if kind == 'dir' else f'{size:>8,}'}  {modified}  {item.name}")
    except PermissionError:
        return {"content": "Permission denied.", "error": True}

    if not entries:
        return {"content": f"Directory `{dir_str or '.'}` is empty."}

    header = f"**{dir_str or '.'}** ({len(entries)} items):"
    return {"content": header + "\n```\n" + "\n".join(entries) + "\n```"}


async def _file_search(pattern: str) -> dict:
    if not pattern:
        return {"content": "Usage: `/file search <pattern>` (e.g. `*.py`)", "error": True}

    root = _workspace_root().resolve()
    matches = []
    for match in glob.glob(str(root / "**" / pattern), recursive=True):
        p = Path(match)
        if str(p.resolve()).startswith(str(root)):
            rel = p.relative_to(root)
            matches.append(str(rel))

    if not matches:
        return {"content": f"No files matching `{pattern}` in workspace."}

    lines = [f"**{len(matches)} files matching `{pattern}`:**", ""]
    for m in matches[:50]:
        lines.append(f"  {m}")
    if len(matches) > 50:
        lines.append(f"  ... and {len(matches) - 50} more")
    return {"content": "\n".join(lines)}


def register_file_commands():
    register_command("file", _file, "Read, write, list, or search files", "/file read|write|list|search <path>")


register_file_commands()
