"""Workspace-scoped file tools for AI agent use."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from config import settings


def _resolve_safe(user_path: str) -> Path | None:
    """Resolve a user-provided path within the workspace. Returns None if it escapes."""
    root = settings.workspace_dir.resolve()
    target = (root / user_path).resolve()
    if not str(target).startswith(str(root)):
        return None
    return target


async def write_file(filename: str, content: str) -> dict:
    """Write content to a file in the workspace directory."""
    if not filename or not filename.strip():
        return {"error": "Filename is required."}
    if not content:
        return {"error": "Content is required."}

    target = _resolve_safe(filename)
    if target is None:
        return {"error": "Access denied: path is outside workspace."}

    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        return {"written": True, "filename": filename, "bytes": len(content.encode("utf-8"))}
    except Exception as e:
        return {"error": f"Failed to write file: {e}"}


async def read_file(filename: str) -> dict:
    """Read a file from the workspace directory."""
    if not filename or not filename.strip():
        return {"error": "Filename is required."}

    target = _resolve_safe(filename)
    if target is None:
        return {"error": "Access denied: path is outside workspace."}

    if not target.exists():
        return {"error": f"File not found: {filename}"}

    if target.is_dir():
        return {"error": f"{filename} is a directory. Use list_files instead."}

    try:
        size = target.stat().st_size
        if size > 100_000:
            return {"error": f"File too large ({size:,} bytes). Maximum is 100KB."}
        text = target.read_text(errors="replace")
        return {"filename": filename, "content": text, "bytes": size}
    except Exception as e:
        return {"error": f"Failed to read file: {e}"}


async def list_files(directory: str = ".") -> dict:
    """List files in a workspace directory."""
    target = _resolve_safe(directory)
    if target is None:
        return {"error": "Access denied: path is outside workspace."}

    if not target.exists():
        return {"error": f"Directory not found: {directory}"}

    if not target.is_dir():
        return {"error": f"{directory} is a file, not a directory."}

    try:
        entries = []
        for item in sorted(target.iterdir()):
            stat = item.stat()
            modified = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            if item.is_dir():
                entries.append({"name": item.name, "type": "directory", "modified": modified})
            else:
                entries.append({"name": item.name, "type": "file", "bytes": stat.st_size, "modified": modified})
        return {"directory": directory, "entries": entries, "count": len(entries)}
    except PermissionError:
        return {"error": "Permission denied."}
    except Exception as e:
        return {"error": f"Failed to list directory: {e}"}
