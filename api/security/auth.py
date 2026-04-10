from __future__ import annotations

import secrets
from pathlib import Path

from fastapi import Request, HTTPException, Depends
from fastapi.security import APIKeyHeader

from config import settings

# Paths that don't require auth
PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _load_api_key() -> str | None:
    """Load the API key from data directory. Returns None if auth is disabled."""
    key_file = settings.data_dir / "api_key"
    if key_file.exists():
        return key_file.read_text().strip()
    return None


def generate_api_key() -> str:
    """Generate a new API key and save it."""
    key = secrets.token_urlsafe(32)
    key_file = settings.data_dir / "api_key"
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key_file.write_text(key)
    return key


def verify_api_key(provided: str) -> bool:
    """Constant-time comparison of API key."""
    stored = _load_api_key()
    if stored is None:
        return True  # Auth disabled if no key file
    return secrets.compare_digest(provided, stored)
