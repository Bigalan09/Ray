"""Admin API: factory reset and dev-mode utilities."""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import settings

router = APIRouter()
log = logging.getLogger(__name__)

# Files in workspace/ that are databases or runtime state (not identity templates).
_DB_FILES = ["conversations.db", "tasks.db", "audit.db"]
_STATE_FILES = ["api_key", "settings.yaml", "schedules.yaml", "skills.yaml", "hooks.log"]
_STATE_DIRS = ["hooks"]


class FactoryResetRequest(BaseModel):
    confirm: bool = False


@router.get("/admin/dev-mode")
async def dev_mode_status():
    """Return whether dev mode is active."""
    return {"dev_mode": True}


@router.post("/admin/factory-reset")
async def factory_reset(body: FactoryResetRequest):
    """Wipe all databases, ChromaDB collections, workspace state, and re-seed
    from workspace-template. Requires confirm=true in the request body."""
    if not body.confirm:
        raise HTTPException(status_code=400, detail="Set confirm: true to proceed with factory reset.")

    ws = settings.workspace_dir
    results: dict[str, str] = {}

    # 1. Delete SQLite databases
    for db_name in _DB_FILES:
        db_path = ws / db_name
        # Also delete WAL/SHM journal files
        for suffix in ("", "-wal", "-shm"):
            p = Path(str(db_path) + suffix)
            if p.exists():
                try:
                    p.unlink()
                except Exception as exc:
                    log.warning("Failed to delete %s: %s", p, exc)
        results[db_name] = "deleted" if not db_path.exists() else "failed"

    # 2. Clear ChromaDB collections
    try:
        from memory.store import _get_collection as _get_mem_collection
        col = _get_mem_collection()
        if col is not None:
            # Delete all entries
            ids = col.get()["ids"]
            if ids:
                col.delete(ids=ids)
            results["chromadb:ray_memories"] = f"cleared ({len(ids)} entries)"
        else:
            results["chromadb:ray_memories"] = "unavailable"
    except Exception as exc:
        results["chromadb:ray_memories"] = f"error: {exc}"

    try:
        from rag.store import _get_collection as _get_doc_collection
        col = _get_doc_collection()
        if col is not None:
            ids = col.get()["ids"]
            if ids:
                col.delete(ids=ids)
            results["chromadb:ray_documents"] = f"cleared ({len(ids)} entries)"
        else:
            results["chromadb:ray_documents"] = "unavailable"
    except Exception as exc:
        results["chromadb:ray_documents"] = f"error: {exc}"

    # 3. Delete state files
    for name in _STATE_FILES:
        p = ws / name
        if p.exists():
            try:
                p.unlink()
                results[name] = "deleted"
            except Exception as exc:
                results[name] = f"error: {exc}"

    # 4. Delete state directories
    for name in _STATE_DIRS:
        p = ws / name
        if p.is_dir():
            try:
                shutil.rmtree(p)
                results[name] = "deleted"
            except Exception as exc:
                results[name] = f"error: {exc}"

    # 5. Delete identity/workspace markdown files (will be re-seeded)
    for name in ["IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "TOOLS.md", "AGENTS.md", "BOOTSTRAP.md"]:
        p = ws / name
        if p.exists():
            try:
                p.unlink()
                results[name] = "deleted"
            except Exception as exc:
                results[name] = f"error: {exc}"

    # 6. Clear memory daily logs
    mem_dir = ws / "memory"
    if mem_dir.is_dir():
        for f in mem_dir.glob("*.md"):
            try:
                f.unlink()
            except Exception:
                pass
        results["memory/"] = "cleared"

    # 7. Re-seed from workspace-template
    from bootstrap import ensure_workspace_seeded
    # Clear bootstrap cache so it re-evaluates
    import bootstrap
    bootstrap._bootstrapped_cache = None
    ensure_workspace_seeded()
    results["workspace-template"] = "re-seeded"

    # 8. Reload hooks config
    try:
        from hooks.engine import hook_engine
        hook_engine.load_config()
        results["hooks"] = "reloaded"
    except Exception:
        pass

    log.info("Factory reset completed: %s", results)
    return {"status": "reset_complete", "details": results}


@router.post("/admin/config-sync")
async def config_sync():
    """Sync config files from upstream source. Returns which files were updated."""
    from config_sync import ensure_config_synced
    synced = ensure_config_synced()
    if not synced:
        return {"status": "up_to_date", "files": {}}
    return {"status": "synced", "files": synced}
