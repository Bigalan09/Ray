"""Settings API — read effective config and manage workspace-level overrides."""
from __future__ import annotations

import yaml
from fastapi import APIRouter
from pydantic import BaseModel

from config import settings, load_yaml

router = APIRouter()

_WORKSPACE_SETTINGS = settings.data_dir / "settings.yaml"

WRITABLE_KEYS = {
    "logging.level",
    "logging.format",
    "logging.enable_llm_logging",
    "logging.llm_log_inputs",
    "logging.llm_log_outputs",
    "logging.slow_request_threshold_ms",
    "logging.enable_request_logging",
    "logging.enable_tool_logging",
    "logging.enable_metrics",
}


def _load_workspace_overrides() -> dict:
    if not _WORKSPACE_SETTINGS.exists():
        return {}
    with open(_WORKSPACE_SETTINGS) as f:
        return yaml.safe_load(f) or {}


def _save_workspace_overrides(data: dict) -> None:
    _WORKSPACE_SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    with open(_WORKSPACE_SETTINGS, "w") as f:
        yaml.safe_dump(data, f, default_flow_style=False)


def _merge(base: dict, overrides: dict) -> dict:
    """Deep merge overrides into base."""
    result = dict(base)
    for k, v in overrides.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _merge(result[k], v)
        else:
            result[k] = v
    return result


@router.get("/settings")
async def get_settings():
    """Return effective settings: base config merged with workspace overrides."""
    logging_cfg = load_yaml("logging.yaml")
    models_cfg = load_yaml("models.yaml")
    guardrails_cfg = load_yaml("guardrails.yaml")

    overrides = _load_workspace_overrides()

    return {
        "logging": _merge(logging_cfg.get("logging", {}), overrides.get("logging", {})),
        "models": {
            "default_model": models_cfg.get("default_model", ""),
            "providers": list(models_cfg.get("providers", {}).keys()),
        },
        "guardrails": {
            "exec_enabled": guardrails_cfg.get("exec", {}).get("enabled", True),
            "exec_default_timeout": guardrails_cfg.get("exec", {}).get("default_timeout", 30),
            "exec_allow": [
                {
                    "command": rule.get("command"),
                    "args": (
                        rule["args"] if isinstance(rule.get("args"), list)
                        else [rule["args"]] if rule.get("args") is not None
                        else []
                    ),
                    "description": rule.get("description", ""),
                }
                for rule in guardrails_cfg.get("exec", {}).get("allow", [])
            ],
        },
        "rate_limit": {
            "enabled": _env_bool("RATE_LIMIT_ENABLED", True),
            "rpm": _env_int("RATE_LIMIT_RPM", 1200),
            "burst": _env_int("RATE_LIMIT_BURST", 200),
            "note": "Rate limit settings are environment-variable-only; restart required to change.",
        },
        "workspace_overrides": overrides,
        "writable_keys": sorted(WRITABLE_KEYS),
    }


class PatchSettingsRequest(BaseModel):
    updates: dict  # e.g. {"logging": {"level": "DEBUG"}}


@router.patch("/settings")
async def patch_settings(req: PatchSettingsRequest):
    """Apply workspace-level overrides for writable keys."""
    # Validate only allowed keys are being set
    rejected = []
    for section, values in req.updates.items():
        if isinstance(values, dict):
            for key in values:
                dotkey = f"{section}.{key}"
                if dotkey not in WRITABLE_KEYS:
                    rejected.append(dotkey)
        else:
            rejected.append(section)

    if rejected:
        from fastapi import HTTPException
        raise HTTPException(
            status_code=400,
            detail=f"These keys are not writable at runtime: {rejected}. "
                   "Restart-required settings must be changed in config files.",
        )

    overrides = _load_workspace_overrides()
    overrides = _merge(overrides, req.updates)
    _save_workspace_overrides(overrides)

    # Apply logging level change immediately if present
    log_overrides = req.updates.get("logging", {})
    if "level" in log_overrides:
        import logging
        level = getattr(logging, log_overrides["level"].upper(), logging.INFO)
        logging.getLogger().setLevel(level)

    return {"success": True, "workspace_overrides": overrides}


@router.delete("/settings/overrides")
async def reset_settings():
    """Remove all workspace overrides, reverting to config file defaults."""
    if _WORKSPACE_SETTINGS.exists():
        _WORKSPACE_SETTINGS.unlink()
    return {"success": True}


def _env_bool(key: str, default: bool) -> bool:
    import os
    val = os.environ.get(key)
    if val is None:
        return default
    return val.lower() in ("1", "true", "yes")


def _env_int(key: str, default: int) -> int:
    import os
    try:
        return int(os.environ.get(key, str(default)))
    except ValueError:
        return default
