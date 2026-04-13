"""Built-in tool: glob_files -- find files in workspace by glob pattern."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from config import settings


_MAX_RESULTS = 500


async def glob_files(pattern: str, max_results: int = 200) -> dict:
    """Find files in the workspace matching a glob pattern.

    Parameters
    ----------
    pattern : str
        Glob pattern to match files (e.g. "**/*.md", "notes/*.txt", "*.json").
    max_results : int
        Maximum number of files to return (default: 200, max: 500).
    """
    if not pattern or not pattern.strip():
        return {"error": "Pattern is required."}

    root = settings.workspace_dir.resolve()
    max_results = min(max_results, _MAX_RESULTS)

    entries: list[dict] = []
    for filepath in sorted(root.glob(pattern)):
        if not filepath.is_file():
            continue
        try:
            stat = filepath.stat()
            rel = str(filepath.relative_to(root))
            entries.append({
                "path": rel,
                "bytes": stat.st_size,
                "modified": datetime.fromtimestamp(
                    stat.st_mtime, tz=timezone.utc
                ).strftime("%Y-%m-%d %H:%M"),
            })
        except Exception:
            continue

        if len(entries) >= max_results:
            return {
                "pattern": pattern,
                "files": entries,
                "count": len(entries),
                "truncated": True,
            }

    return {
        "pattern": pattern,
        "files": entries,
        "count": len(entries),
        "truncated": False,
    }
