"""Built-in tool: grep_files -- search workspace file contents with regex."""
from __future__ import annotations

import re
from pathlib import Path

from config import settings


_MAX_MATCHES = 100
_MAX_FILE_SIZE = 512_000  # skip files larger than 512 KB


async def grep_files(
    pattern: str,
    glob: str = "**/*",
    max_results: int = 50,
    context_lines: int = 0,
    case_insensitive: bool = False,
) -> dict:
    """Search workspace files for lines matching a regex pattern.

    Parameters
    ----------
    pattern : str
        Regular expression to search for.
    glob : str
        Glob pattern to filter which files are searched (default: all files).
    max_results : int
        Maximum number of matching lines to return (default: 50, max: 100).
    context_lines : int
        Number of lines to include before and after each match (default: 0).
    case_insensitive : bool
        Whether to ignore case when matching (default: False).
    """
    if not pattern or not pattern.strip():
        return {"error": "Pattern is required."}

    root = settings.workspace_dir.resolve()
    max_results = min(max_results, _MAX_MATCHES)

    flags = re.IGNORECASE if case_insensitive else 0
    try:
        regex = re.compile(pattern, flags)
    except re.error as exc:
        return {"error": f"Invalid regex: {exc}"}

    matches: list[dict] = []
    files_searched = 0
    files_matched = 0

    for filepath in sorted(root.glob(glob)):
        if not filepath.is_file():
            continue
        if filepath.stat().st_size > _MAX_FILE_SIZE:
            continue

        files_searched += 1
        try:
            lines = filepath.read_text(errors="replace").splitlines()
        except Exception:
            continue

        file_has_match = False
        for i, line in enumerate(lines):
            if regex.search(line):
                if not file_has_match:
                    files_matched += 1
                    file_has_match = True

                rel = str(filepath.relative_to(root))
                match_entry: dict = {
                    "file": rel,
                    "line_number": i + 1,
                    "content": line.rstrip(),
                }

                if context_lines > 0:
                    start = max(0, i - context_lines)
                    end = min(len(lines), i + context_lines + 1)
                    match_entry["context"] = [
                        {"line": j + 1, "content": lines[j].rstrip()}
                        for j in range(start, end)
                    ]

                matches.append(match_entry)
                if len(matches) >= max_results:
                    return {
                        "pattern": pattern,
                        "glob": glob,
                        "matches": matches,
                        "files_searched": files_searched,
                        "files_matched": files_matched,
                        "truncated": True,
                    }

    return {
        "pattern": pattern,
        "glob": glob,
        "matches": matches,
        "files_searched": files_searched,
        "files_matched": files_matched,
        "truncated": False,
    }
