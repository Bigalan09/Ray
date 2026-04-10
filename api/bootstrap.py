"""Bootstrap detection and state management.

On first run, template files from workspace-template/ are copied into
workspace/ if it is empty. Bootstrap is complete when workspace/IDENTITY.md
exists. After bootstrap, workspace/BOOTSTRAP.md is deleted.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from config import settings


_bootstrapped_cache: bool | None = None

# Template dir ships with the repo; workspace/ is personal state
_TEMPLATE_DIR_NAME = "workspace-template"


def ensure_workspace_seeded() -> None:
    """Copy template files into workspace/ if they do not exist yet."""
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
