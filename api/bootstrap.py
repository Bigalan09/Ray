"""Bootstrap detection and state management.

On first run, template files from workspace-template/ are copied into
workspace/ if it is empty. Bootstrap is complete when workspace/IDENTITY.md
exists. After bootstrap, workspace/BOOTSTRAP.md is deleted.

On every startup, template files that have changed upstream are refreshed
in workspace/ — except for user-edited identity files.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from config import settings
from fsutil import copy_if_changed

log = logging.getLogger(__name__)

_bootstrapped_cache: bool | None = None

_TEMPLATE_DIR = Path("/workspace-template")

# Files the user edits after bootstrap — never overwrite from template.
_USER_EDITED_FILES = {"SOUL.md", "USER.md", "IDENTITY.md", "MEMORY.md"}


def ensure_workspace_seeded() -> None:
    """Seed or refresh workspace from template, preserving user-edited files."""
    ws = settings.workspace_dir
    ws.mkdir(parents=True, exist_ok=True)
    (ws / "memory").mkdir(exist_ok=True)

    if not _TEMPLATE_DIR.exists():
        return

    for src in _TEMPLATE_DIR.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(_TEMPLATE_DIR)
        dest = ws / rel
        if dest.exists() and rel.name in _USER_EDITED_FILES:
            continue
        if copy_if_changed(src, dest):
            log.info("Workspace template: %s", rel)


def is_bootstrapped() -> bool:
    """Check if the agent has completed onboarding. Cached after first True."""
    global _bootstrapped_cache
    if _bootstrapped_cache:
        return True
    result = (settings.workspace_dir / "IDENTITY.md").exists()
    if result:
        _bootstrapped_cache = True
    return result


def has_existing_identity() -> bool:
    """Check if SOUL.md or USER.md already have content."""
    from agents.prompt_builder import load_workspace_file
    for name in ("SOUL.md", "USER.md"):
        content = load_workspace_file(name)
        if content and len(content) > 50:
            return True
    return False


def mark_bootstrapped(identity_md: str, soul_md: str = "", user_md: str = "") -> None:
    """Write identity files to workspace, completing bootstrap."""
    ws = settings.workspace_dir
    ws.mkdir(parents=True, exist_ok=True)
    (ws / "IDENTITY.md").write_text(identity_md, encoding="utf-8")
    if soul_md:
        (ws / "SOUL.md").write_text(soul_md, encoding="utf-8")
    if user_md:
        (ws / "USER.md").write_text(user_md, encoding="utf-8")
    bootstrap_path = ws / "BOOTSTRAP.md"
    if bootstrap_path.exists():
        bootstrap_path.unlink()


def reset_bootstrap() -> None:
    """Remove IDENTITY.md to re-trigger onboarding. Re-seed BOOTSTRAP.md from template."""
    global _bootstrapped_cache
    _bootstrapped_cache = None
    ws = settings.workspace_dir
    identity = ws / "IDENTITY.md"
    if identity.exists():
        identity.unlink()
    src = _TEMPLATE_DIR / "BOOTSTRAP.md"
    if src.exists():
        shutil.copy2(src, ws / "BOOTSTRAP.md")
