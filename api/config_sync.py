"""Config sync: keep deployment config in sync with upstream repo defaults.

On startup, compares config files against an upstream source directory
(mounted read-only at /config-upstream). YAML files are merged so
deployment-specific overrides in PRESERVE_KEYS are kept. Non-YAML files
are replaced wholesale. Sync is skipped silently when the upstream mount
is absent.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path

import yaml

from config import settings
from fsutil import copy_if_changed, file_hash

log = logging.getLogger(__name__)

UPSTREAM_DIR = Path("/config-upstream")

PRESERVE_KEYS: dict[str, list[str]] = {
    "models.yaml": ["default_model"],
    "models.yml": ["default_model"],
}

SKIP_FILES: set[str] = {"prometheus.yml", "loki.yml", "promtail.yml"}
SKIP_DIRS: set[str] = {"grafana"}

_YAML_EXTS = (".yaml", ".yml")


def _merge_yaml(upstream_path: Path, local_path: Path, preserve_keys: list[str]) -> None:
    """Replace local YAML with upstream, restoring preserved keys from local."""
    with open(upstream_path) as f:
        merged = yaml.safe_load(f) or {}
    with open(local_path) as f:
        local = yaml.safe_load(f) or {}
    for key in preserve_keys:
        if key in local:
            merged[key] = local[key]
    with open(local_path, "w") as f:
        yaml.dump(merged, f, default_flow_style=False, sort_keys=False, allow_unicode=True)


def _sync_file(upstream_file: Path, local_file: Path, filename: str) -> str | None:
    if not local_file.exists():
        copy_if_changed(upstream_file, local_file)
        return "added (new from upstream)"

    if file_hash(upstream_file) == file_hash(local_file):
        return None

    if filename.endswith(_YAML_EXTS):
        preserve = PRESERVE_KEYS.get(filename, [])
        _merge_yaml(upstream_file, local_file, preserve)
        if preserve:
            return f"merged (preserved: {', '.join(preserve)})"
        return "merged"

    shutil.copy2(upstream_file, local_file)
    return "replaced"


def ensure_config_synced(upstream_dir: Path | None = None) -> dict[str, str]:
    """Sync config files from upstream to deployment config directory.

    Returns a dict of filename -> action taken. Empty if nothing changed
    or upstream is not available.
    """
    upstream = upstream_dir or UPSTREAM_DIR
    if not upstream.exists():
        return {}

    config_dir = settings.config_dir
    config_dir.mkdir(parents=True, exist_ok=True)

    results: dict[str, str] = {}

    for upstream_file in sorted(upstream.rglob("*")):
        if not upstream_file.is_file():
            continue

        rel = upstream_file.relative_to(upstream)
        if rel.name in SKIP_FILES or rel.parts[0] in SKIP_DIRS:
            continue

        local_file = config_dir / rel
        try:
            status = _sync_file(upstream_file, local_file, rel.name)
        except (OSError, yaml.YAMLError) as exc:
            results[str(rel)] = f"error: {exc}"
            log.warning("Config sync failed for %s: %s", rel, exc)
            continue

        if status:
            results[str(rel)] = status
            log.info("Config sync: %s — %s", rel, status)

    if results:
        log.info("Config sync complete: %d files updated", len(results))
    return results
