"""Structured logging for LLM requests and responses."""
from __future__ import annotations

import time

import structlog

from .context import get_request_id, get_correlation_id
from .metrics import (
    llm_requests_total,
    llm_request_duration,
    llm_tokens_total,
    llm_retries_total,
)
from .setup import get_log_config

log = structlog.get_logger("ray.llm")


def _truncate(value: str | None, max_len: int) -> str | None:
    if not value or not max_len:
        return value
    return value[:max_len] + "…" if len(value) > max_len else value


def log_llm_request(
    *,
    model: str,
    provider: str,
    agent: str,
    message_count: int,
    tool_count: int,
    temperature: float | None,
    system_prompt: str | None = None,
    messages: list[dict] | None = None,
) -> float:
    """Log an outgoing LLM request. Returns a start timestamp for use in log_llm_response."""
    cfg = get_log_config()
    if not cfg.get("enable_llm_logging", True):
        return time.perf_counter()

    max_len: int = cfg.get("max_log_length", 1000)
    log_inputs: bool = cfg.get("llm_log_inputs", False)

    extra: dict = {
        "model": model,
        "provider": provider,
        "agent": agent,
        "message_count": message_count,
        "tool_count": tool_count,
        "temperature": temperature,
        "req_id": get_request_id(),
        "correlation_id": get_correlation_id(),
    }

    if log_inputs and system_prompt is not None:
        extra["system_prompt"] = _truncate(system_prompt, max_len)

    if log_inputs and messages is not None:
        extra["messages"] = [
            {
                "role": m.get("role"),
                "content": _truncate(str(m.get("content", "")), max_len),
            }
            for m in messages
        ]

    log.info("llm_request", **extra)
    return time.perf_counter()


def log_llm_response(
    *,
    model: str,
    provider: str,
    agent: str,
    finish_reason: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    total_tokens: int = 0,
    tool_call_count: int = 0,
    round_number: int = 1,
    start_time: float,
    response_text: str | None = None,
    error: str | None = None,
) -> None:
    """Log the result of an LLM request and record Prometheus metrics."""
    cfg = get_log_config()
    duration_ms = (time.perf_counter() - start_time) * 1000

    if cfg.get("enable_llm_logging", True):
        max_len: int = cfg.get("max_log_length", 1000)
        log_outputs: bool = cfg.get("llm_log_outputs", False)

        extra: dict = {
            "model": model,
            "provider": provider,
            "agent": agent,
            "finish_reason": finish_reason,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "tool_call_count": tool_call_count,
            "round": round_number,
            "duration_ms": round(duration_ms, 2),
            "req_id": get_request_id(),
            "correlation_id": get_correlation_id(),
        }
        if error:
            extra["error"] = error
        if log_outputs and response_text is not None:
            extra["response_text"] = _truncate(response_text, max_len)

        log_fn = log.error if error else log.info
        log_fn("llm_response", **extra)

    # Prometheus
    try:
        llm_requests_total.labels(
            model=model, provider=provider, finish_reason=finish_reason
        ).inc()
        llm_request_duration.labels(model=model, provider=provider).observe(duration_ms / 1000)
        if prompt_tokens:
            llm_tokens_total.labels(model=model, provider=provider, type="prompt").inc(
                prompt_tokens
            )
        if completion_tokens:
            llm_tokens_total.labels(model=model, provider=provider, type="completion").inc(
                completion_tokens
            )
    except Exception:
        pass


def log_llm_retry(*, model: str, provider: str, attempt: int, status: int, wait_s: float) -> None:
    cfg = get_log_config()
    if cfg.get("enable_llm_logging", True):
        log.warning(
            "llm_retry",
            model=model,
            provider=provider,
            attempt=attempt,
            status=status,
            wait_s=wait_s,
            req_id=get_request_id(),
            correlation_id=get_correlation_id(),
        )
    try:
        llm_retries_total.labels(model=model, provider=provider, status=str(status)).inc()
    except Exception:
        pass


def log_tool_call(
    *,
    tool: str,
    args: dict,
    result: dict | None = None,
    error: str | None = None,
    duration_ms: float = 0,
) -> None:
    cfg = get_log_config()
    if not cfg.get("enable_tool_logging", True):
        return

    from .metrics import tool_calls_total, tool_call_duration

    status = "error" if error else "success"
    max_len: int = cfg.get("max_log_length", 1000)

    log_fn = log.error if error else log.info
    log_fn(
        "tool_call",
        tool=tool,
        args=str(args)[:max_len],
        result=_truncate(str(result), max_len) if result is not None else None,
        error=error,
        duration_ms=round(duration_ms, 2),
        status=status,
        req_id=get_request_id(),
        correlation_id=get_correlation_id(),
    )

    try:
        tool_calls_total.labels(tool=tool, status=status).inc()
        if duration_ms:
            tool_call_duration.labels(tool=tool).observe(duration_ms / 1000)
    except Exception:
        pass
