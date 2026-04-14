"""Bootstrap detection and state management.

On first run, template files from workspace-template/ are copied into
workspace/ if it is empty. Bootstrap is complete when workspace/IDENTITY.md
exists. After bootstrap, workspace/BOOTSTRAP.md is deleted.

On every startup, config files are synced from /config-upstream (when
available) so deployment config stays in sync with repo defaults.
"""
from __future__ import annotations

import hashlib
import logging
import shutil
from pathlib import Path

from config import settings

log = logging.getLogger(__name__)

_bootstrapped_cache: bool | None = None

# Template dir ships with the repo; workspace/ is personal state
_TEMPLATE_DIR_NAME = "workspace-template"

# Workspace files that are user-edited after bootstrap and should NOT
# be overwritten by template updates.
_USER_EDITED_FILES = {"SOUL.md", "USER.md", "IDENTITY.md", "MEMORY.md"}


def _file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ensure_workspace_seeded() -> None:
    """Copy template files into workspace/ if they do not exist yet.

    For files that already exist, update them if the template has changed
    — unless they are user-edited identity files.
    """
    ws = settings.workspace_dir
    ws.mkdir(parents=True, exist_ok=True)
    (ws / "memory").mkdir(exist_ok=True)

    template_dir = Path("/workspace-template")
    if not template_dir.exists():
        return

    for src in template_dir.rglob("*"):
        if src.is_file():
            rel = src.relative_to(template_dir)
            dest = ws / rel
            if not dest.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
            elif rel.name not in _USER_EDITED_FILES:
                # Update non-identity files if template has changed
                if _file_hash(src) != _file_hash(dest):
                    shutil.copy2(src, dest)
                    log.info("Workspace template updated: %s", rel)


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
    template_dir = Path("/workspace-template")
    src = template_dir / "BOOTSTRAP.md"
    dest = ws / "BOOTSTRAP.md"
    if src.exists():
        shutil.copy2(src, dest)
