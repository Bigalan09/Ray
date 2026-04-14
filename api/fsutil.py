"""Filesystem utilities shared across bootstrap and config sync."""
from __future__ import annotations

import hashlib
import shutil
from pathlib import Path


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def copy_if_changed(src: Path, dest: Path) -> bool:
    """Copy src to dest if dest is missing or differs. Returns True if copied."""
    if dest.exists() and file_hash(src) == file_hash(dest):
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)
    return True
