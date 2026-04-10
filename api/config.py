from __future__ import annotations

import os
from pathlib import Path

import yaml
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment and YAML config."""

    model_config = {"env_file": ".env", "extra": "ignore"}

    # OpenAI Responses API (primary path)
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"

    # Legacy Azure OpenAI direct provider (optional)
    azure_openai_api_key: str = ""
    azure_openai_endpoint: str = ""
    azure_openai_api_version: str = "2024-05-01-preview"

    # Paths
    config_dir: Path = Path("/config")
    data_dir: Path = Path("/workspace")  # Writable: databases, identity, memory (all in workspace)
    workspace_dir: Path = Path("/workspace")  # Ray's home

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    # Streaming
    max_retries: int = 3
    base_delay_ms: int = 1000
    tls_verify: bool = False


settings = Settings()


def _resolve_env_vars(value: str) -> str:
    """Replace ${VAR} and ${VAR:default} placeholders with environment variable values."""
    if not isinstance(value, str):
        return value
    import re
    def _replace(match: re.Match) -> str:
        var_name = match.group(1)
        default = match.group(2)
        return os.environ.get(var_name, default if default is not None else "")
    return re.sub(r"\$\{(\w+)(?::([^}]*))?\}", _replace, value)


def _walk_resolve(obj):
    """Recursively resolve env vars in a nested dict/list."""
    if isinstance(obj, dict):
        return {k: _walk_resolve(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_walk_resolve(item) for item in obj]
    if isinstance(obj, str):
        return _resolve_env_vars(obj)
    return obj


def load_yaml(filename: str) -> dict:
    """Load a YAML config file from the config directory, resolving env vars."""
    path = settings.config_dir / filename
    if not path.exists():
        return {}
    with open(path) as f:
        raw = yaml.safe_load(f) or {}
    return _walk_resolve(raw)
