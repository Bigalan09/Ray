"""In-memory store for pending exec commands awaiting user approval."""
from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

TTL_SECONDS = 300  # 5 minutes


@dataclass
class PendingExec:
    """A command validated and waiting for user approval."""

    id: str
    tokens: list[str]
    rule: dict
    timeout: int
    working_dir: str
    max_output: int = 65536
    created_at: float = field(default_factory=time.time)
    # Signalled by approve/deny endpoints so the agent loop can resume.
    resolved: asyncio.Event = field(default_factory=asyncio.Event)
    approved: bool = False
    # Populated by the approve endpoint after execution.
    exec_result: dict | None = None


_pending: dict[str, PendingExec] = {}


def create_pending(
    tokens: list[str],
    rule: dict,
    timeout: int,
    working_dir: str,
    max_output: int = 65536,
) -> PendingExec:
    """Create a new pending execution record."""
    _cleanup_expired()
    pending = PendingExec(
        id=uuid.uuid4().hex[:12],
        tokens=tokens,
        rule=rule,
        timeout=timeout,
        working_dir=working_dir,
        max_output=max_output,
    )
    _pending[pending.id] = pending
    return pending


def get_pending(pending_id: str) -> PendingExec | None:
    """Retrieve a pending execution. Returns None if not found or expired."""
    _cleanup_expired()
    return _pending.get(pending_id)


def remove_pending(pending_id: str) -> None:
    """Remove a pending execution (after approval or denial)."""
    _pending.pop(pending_id, None)


def list_pending() -> list[dict]:
    """Return a summary of all pending (non-expired) exec commands."""
    _cleanup_expired()
    return [
        {
            "id": p.id,
            "command": " ".join(p.tokens),
            "created_at": p.created_at,
        }
        for p in _pending.values()
    ]


def _cleanup_expired() -> None:
    """Remove all expired entries. Called lazily."""
    now = time.time()
    expired = [k for k, v in _pending.items() if now - v.created_at > TTL_SECONDS]
    for k in expired:
        del _pending[k]
