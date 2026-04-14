"""Config sync: keep deployment config in sync with upstream repo defaults.

On startup, compares config files against an upstream source directory
(mounted read-only at /config-upstream). Files that differ are merged:
- YAML files: upstream keys are added/updated, but deployment-specific
  overrides listed in PRESERVE_KEYS are kept.
- Non-YAML files: replaced wholesale if upstream is newer.

The upstream mount is optional — sync is skipped silently when absent.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

import yaml

from config import settings

log = logging.getLogger(__name__)

# Default upstream directory (repo config mounted read-only in deployment)
UPSTREAM_DIR = Path("/config-upstream")

# State file tracking last sync hashes
_SYNC_STATE_FILE = "config_sync_state.json"

# Keys in specific YAML files that should NOT be overwritten by upstream,
# because they are intentional deployment-specific overrides.
PRESERVE_KEYS: dict[str, list[str]] = {
    "models.yaml": ["default_model"],
}

# Files to skip entirely (deployment-managed, not from repo)
SKIP_FILES: set[str] = {
    "prometheus.yml",
    "loki.yml",
    "promtail.yml",
}


def _file_hash(path: Path) -> str:
    """SHA-256 hex digest of a file."""
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_sync_state() -> dict:
    """Load previous sync state from workspace."""
    state_path = settings.workspace_dir / _SYNC_STATE_FILE
    if state_path.exists():
        try:
            return json.loads(state_path.read_text())
        except Exception:
            return {}
    return {}


def _save_sync_state(state: dict) -> None:
    """Persist sync state to workspace."""
    state_path = settings.workspace_dir / _SYNC_STATE_FILE
    state_path.write_text(json.dumps(state, indent=2))


def _merge_yaml(upstream_path: Path, local_path: Path, preserve_keys: list[str]) -> bool:
    """Merge upstream YAML into local, preserving specified keys.

    Returns True if the local file was updated.
    """
    with open(upstream_path) as f:
        upstream = yaml.safe_load(f) or {}
    with open(local_path) as f:
        local = yaml.safe_load(f) or {}

    # Save values that should be preserved
    preserved = {}
    for key in preserve_keys:
        if key in local:
            preserved[key] = local[key]

    # Check if upstream has changes we need
    upstream_hash = _file_hash(upstream_path)
    local_hash = _file_hash(local_path)
    if upstream_hash == local_hash:
        return False

    # Replace local with upstream, then restore preserved keys
    merged = upstream.copy()
    for key, value in preserved.items():
        merged[key] = value

    # Write merged result
    with open(local_path, "w") as f:
        yaml.dump(merged, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

    return True


def _sync_file(upstream_file: Path, local_file: Path, filename: str) -> str | None:
    """Sync a single file. Returns a status message or None if no change."""
    if not local_file.exists():
        # New file from upstream — copy it
        local_file.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(upstream_file, local_file)
        return f"added (new from upstream)"

    # Check if files differ
    if _file_hash(upstream_file) == _file_hash(local_file):
        return None

    # YAML files get merged to preserve deployment overrides
    if filename.endswith((".yaml", ".yml")):
        preserve = PRESERVE_KEYS.get(filename, [])
        updated = _merge_yaml(upstream_file, local_file, preserve)
        if updated:
            preserved_note = f" (preserved: {', '.join(preserve)})" if preserve else ""
            return f"merged{preserved_note}"
        return None

    # Non-YAML files (e.g. .md) — replace with upstream
    shutil.copy2(upstream_file, local_file)
    return "replaced"


def ensure_config_synced(upstream_dir: Path | None = None) -> dict[str, str]:
    """Sync config files from upstream to deployment config directory.

    Args:
        upstream_dir: Path to upstream config (default: /config-upstream).

    Returns:
        Dict of filename -> action taken. Empty if nothing changed or
        upstream is not available.
    """
    upstream = upstream_dir or UPSTREAM_DIR
    if not upstream.exists():
        return {}

    config_dir = settings.config_dir
    if not config_dir.exists():
        config_dir.mkdir(parents=True, exist_ok=True)

    results: dict[str, str] = {}

    for upstream_file in sorted(upstream.rglob("*")):
        if not upstream_file.is_file():
            continue

        rel = upstream_file.relative_to(upstream)
        filename = str(rel)

        # Skip files managed outside the repo
        if rel.name in SKIP_FILES:
            continue
        # Skip subdirectories like grafana/ that have their own mounts
        if rel.parts[0] in ("grafana",):
            continue

        local_file = config_dir / rel

        try:
            status = _sync_file(upstream_file, local_file, rel.name)
            if status:
                results[filename] = status
                log.info("Config sync: %s — %s", filename, status)
        except Exception as exc:
            results[filename] = f"error: {exc}"
            log.warning("Config sync failed for %s: %s", filename, exc)

    if results:
        state = _load_sync_state()
        state["last_sync"] = datetime.now(timezone.utc).isoformat()
        state["files_synced"] = results
        _save_sync_state(state)
        log.info("Config sync complete: %d files updated", len(results))
    else:
        log.debug("Config sync: all files up to date")

    return results
