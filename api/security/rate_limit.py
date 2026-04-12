from __future__ import annotations

import os
import time
from collections import defaultdict

from fastapi import Request, HTTPException

_DEFAULT_RPM = 1200
_DEFAULT_BURST = 200

# Try Redis, fall back to in-memory
_redis_client = None
_fallback: dict[str, list[float]] = defaultdict(list)


def _env_flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        parsed = int(raw)
    except ValueError:
        return default
    return parsed if parsed > 0 else default


def get_rate_limit_config() -> tuple[bool, int, int]:
    """Return rate limit enablement and thresholds from environment."""
    enabled = _env_flag("RATE_LIMIT_ENABLED", True)
    rpm = _env_int("RATE_LIMIT_RPM", _DEFAULT_RPM)
    burst = _env_int("RATE_LIMIT_BURST", _DEFAULT_BURST)
    return enabled, rpm, burst


def _get_client_key(request: Request) -> str:
    api_key = request.headers.get("x-api-key", "").strip()
    if api_key:
        return f"api-key:{api_key}"

    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        return f"ip:{forwarded_for.split(',')[0].strip()}"

    real_ip = request.headers.get("x-real-ip", "").strip()
    if real_ip:
        return f"ip:{real_ip}"

    ip = request.client.host if request.client else "unknown"
    return f"ip:{ip}"


def _get_redis():
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    redis_url = os.environ.get("REDIS_URL")
    if not redis_url:
        return None
    try:
        import redis
        _redis_client = redis.from_url(redis_url, decode_responses=True)
        _redis_client.ping()
        return _redis_client
    except Exception:
        _redis_client = None
        return None


def check_rate_limit(request: Request) -> None:
    """Check rate limit. Uses Redis if available, else in-memory."""
    if request.url.path == "/health":
        return

    enabled, rpm, burst = get_rate_limit_config()
    if not enabled:
        return

    client_key = _get_client_key(request)
    r = _get_redis()

    if r:
        try:
            _check_redis(r, client_key, rpm, burst)
        except HTTPException:
            raise
        except Exception:
            # Redis write failed (e.g. disk full, RDB error) — fall back to
            # in-memory so a storage hiccup doesn't block all requests.
            global _redis_client
            _redis_client = None
            _check_memory(client_key, rpm, burst)
    else:
        _check_memory(client_key, rpm, burst)


def _check_redis(r, client_key: str, rpm: int, burst: int) -> None:
    """Redis-backed sliding window rate limit."""
    now = time.time()
    key = f"ratelimit:{client_key}"

    pipe = r.pipeline()
    pipe.zremrangebyscore(key, 0, now - 60)
    pipe.zadd(key, {str(now): now})
    pipe.zcard(key)
    pipe.expire(key, 120)
    results = pipe.execute()

    count = results[2]
    if count > rpm:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")

    # Burst check (last second)
    burst_count = r.zcount(key, now - 1, now)
    if burst_count > burst:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")


def _check_memory(client_key: str, rpm: int, burst: int) -> None:
    """In-memory fallback rate limit."""
    now = time.time()
    _fallback[client_key] = [t for t in _fallback[client_key] if t > now - 60]

    if len(_fallback[client_key]) >= rpm:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")

    recent = [t for t in _fallback[client_key] if t > now - 1]
    if len(recent) >= burst:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")

    _fallback[client_key].append(now)
