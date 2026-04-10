"""Built-in hook handlers: webhook HTTP calls and file logging."""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time

import httpx

from hooks.models import RetryConfig

log = logging.getLogger(__name__)


async def webhook_handler(
    url: str,
    method: str,
    headers: dict[str, str],
    payload: dict,
    secret: str = "",
    timeout: float = 10.0,
    retry: RetryConfig | None = None,
) -> dict:
    """Send a webhook HTTP request with optional HMAC signing and retry."""
    body = json.dumps(payload, default=str)
    req_headers = {"Content-Type": "application/json", **headers}

    if secret:
        signature = hmac.new(
            secret.encode(), body.encode(), hashlib.sha256
        ).hexdigest()
        req_headers["X-Ray-Signature"] = signature

    retry = retry or RetryConfig()
    last_error = None

    for attempt in range(retry.max_attempts):
        start = time.monotonic()
        try:
            async with httpx.AsyncClient(verify=False, timeout=timeout) as client:
                resp = await client.request(method, url, content=body, headers=req_headers)
                elapsed = (time.monotonic() - start) * 1000
                return {
                    "success": resp.status_code < 400,
                    "status_code": resp.status_code,
                    "duration_ms": round(elapsed, 1),
                }
        except Exception as exc:
            last_error = str(exc)
            if attempt < retry.max_attempts - 1:
                import asyncio
                await asyncio.sleep(retry.backoff_ms / 1000 * (2 ** attempt))

    elapsed = (time.monotonic() - start) * 1000
    return {
        "success": False,
        "status_code": None,
        "error": last_error,
        "duration_ms": round(elapsed, 1),
    }


async def log_handler(path: str, event: str, context: dict) -> dict:
    """Append an event to a log file."""
    from datetime import datetime, timezone
    try:
        ts = datetime.now(timezone.utc).isoformat()
        line = json.dumps({"timestamp": ts, "event": event, "context": context}, default=str)
        with open(path, "a") as f:
            f.write(line + "\n")
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}
