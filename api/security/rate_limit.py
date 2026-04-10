from __future__ import annotations

import os
import time
from collections import defaultdict

from fastapi import Request, HTTPException

_RPM = 120
_BURST = 20

# Try Redis, fall back to in-memory
_redis_client = None
_fallback: dict[str, list[float]] = defaultdict(list)


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

    ip = request.client.host if request.client else "unknown"
    r = _get_redis()

    if r:
        _check_redis(r, ip)
    else:
        _check_memory(ip)


def _check_redis(r, ip: str) -> None:
    """Redis-backed sliding window rate limit."""
    now = time.time()
    key = f"ratelimit:{ip}"

    pipe = r.pipeline()
    pipe.zremrangebyscore(key, 0, now - 60)
    pipe.zadd(key, {str(now): now})
    pipe.zcard(key)
    pipe.expire(key, 120)
    results = pipe.execute()

    count = results[2]
    if count > _RPM:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")

    # Burst check (last second)
    burst_count = r.zcount(key, now - 1, now)
    if burst_count > _BURST:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")


def _check_memory(ip: str) -> None:
    """In-memory fallback rate limit."""
    now = time.time()
    _fallback[ip] = [t for t in _fallback[ip] if t > now - 60]

    if len(_fallback[ip]) >= _RPM:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")

    recent = [t for t in _fallback[ip] if t > now - 1]
    if len(recent) >= _BURST:
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")

    _fallback[ip].append(now)
