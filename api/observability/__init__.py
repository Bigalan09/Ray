"""Observability: structured logging, correlation IDs, and Prometheus metrics."""
from .context import request_id_var, correlation_id_var, get_request_id, get_correlation_id
from .setup import configure_logging, get_log_config
from .metrics import (
    http_requests_total,
    http_request_duration,
    llm_requests_total,
    llm_request_duration,
    llm_tokens_total,
    tool_calls_total,
    tool_call_duration,
    REGISTRY,
)
from .llm_logger import log_llm_request, log_llm_response

__all__ = [
    "request_id_var",
    "correlation_id_var",
    "get_request_id",
    "get_correlation_id",
    "configure_logging",
    "get_log_config",
    "http_requests_total",
    "http_request_duration",
    "llm_requests_total",
    "llm_request_duration",
    "llm_tokens_total",
    "tool_calls_total",
    "tool_call_duration",
    "REGISTRY",
    "log_llm_request",
    "log_llm_response",
]
