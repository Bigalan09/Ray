"""Pydantic models for the hooks system."""
from __future__ import annotations

from pydantic import BaseModel


class RetryConfig(BaseModel):
    max_attempts: int = 3
    backoff_ms: int = 1000


class WebhookConfig(BaseModel):
    name: str
    url: str
    events: list[str] = []
    method: str = "POST"
    headers: dict[str, str] = {}
    secret: str = ""
    enabled: bool = True
    retry: RetryConfig = RetryConfig()
    source: str = "config"  # "config" | "runtime"


class PrePostHook(BaseModel):
    id: str = ""            # auto-assigned on creation
    name: str = ""          # human label
    type: str = "post"      # "pre" | "post"
    trigger: str = "*"      # "command:exec", "tool:write_file", "tool:*", "command:*"
    handler: str = "log"    # "webhook" | "log"
    enabled: bool = True
    config: dict = {}


class HookLogEntry(BaseModel):
    timestamp: str
    event: str
    webhook_name: str | None = None
    success: bool
    status_code: int | None = None
    error: str | None = None
    duration_ms: float = 0


# All supported event names.
# Legacy underscore-separated events (webhook-oriented, kept for backwards compat).
SUPPORTED_EVENTS = [
    "message_received",
    "command_executed",
    "tool_executing",
    "tool_executed",
    "response_persisted",
    "exec_approved",
    "exec_denied",
    "task_started",
    "task_completed",
    "task_failed",
    "session_created",
    "session_deleted",
]

# Internal hook events (colon-separated, for in-process Python listeners).
INTERNAL_EVENTS = [
    # Gateway lifecycle
    "gateway:startup",
    # Commands
    "command",              # any command executed
    "command:new",          # /new
    "command:reset",        # /bootstrap reset
    "command:stop",         # task cancel / abort
    # Session lifecycle
    "session:compact:before",
    "session:compact:after",
    "session:patch",        # conversation metadata update
    # Agent
    "agent:bootstrap",      # bootstrap onboarding completed
    # Message lifecycle
    "message:received",     # user message arrives
    "message:preprocessed", # after proactive memory injection / system prompt built
    "message:sent",         # assistant response persisted
]

# Combined list for validation / API display.
ALL_EVENTS = SUPPORTED_EVENTS + INTERNAL_EVENTS
