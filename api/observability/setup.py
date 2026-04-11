"""Structured logging configuration via structlog."""
from __future__ import annotations

import logging
import sys
from functools import lru_cache

import structlog

from .context import get_request_id, get_correlation_id


def _inject_request_ids(logger, method, event_dict):
    """Processor: inject correlation/request IDs from context vars."""
    req_id = get_request_id()
    corr_id = get_correlation_id()
    if req_id:
        event_dict["req_id"] = req_id
    if corr_id and corr_id != req_id:
        event_dict["correlation_id"] = corr_id
    return event_dict


@lru_cache(maxsize=1)
def get_log_config() -> dict:
    """Load logging config from config/logging.yaml (cached)."""
    try:
        from config import load_yaml
        return load_yaml("logging.yaml").get("logging", {})
    except Exception:
        return {}


def configure_logging() -> None:
    """Configure structlog and stdlib logging based on config/logging.yaml."""
    cfg = get_log_config()
    level_name = cfg.get("level", "INFO").upper()
    fmt = cfg.get("format", "json")
    log_level = getattr(logging, level_name, logging.INFO)

    shared_processors = [
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        _inject_request_ids,
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if fmt == "json":
        renderer = structlog.processors.JSONRenderer()
    else:
        renderer = structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())

    structlog.configure(
        processors=shared_processors + [renderer],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Also wire stdlib logging through structlog so third-party logs are structured.
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=log_level,
    )
    for noisy in ("uvicorn.access", "httpx", "chromadb", "openai"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
