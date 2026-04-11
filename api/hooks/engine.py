"""Hook engine: config loading, event dispatch, webhook CRUD."""
from __future__ import annotations

import asyncio
import fnmatch
import json
import logging
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import yaml

from config import load_yaml, settings
from hooks.models import (
    WebhookConfig,
    PrePostHook,
    HookLogEntry,
    SUPPORTED_EVENTS,
)
from hooks.handlers import webhook_handler, log_handler

log = logging.getLogger(__name__)

# Singleton ring buffer for recent hook activity.
_hook_log: deque[HookLogEntry] = deque(maxlen=100)


class HookEngine:
    """Central dispatcher for lifecycle events, webhooks, and pre/post hooks."""

    def __init__(self):
        self._webhooks: list[WebhookConfig] = []
        self._pre_hooks: list[PrePostHook] = []
        self._post_hooks: list[PrePostHook] = []

    # ------------------------------------------------------------------
    # Config loading
    # ------------------------------------------------------------------

    def load_config(self):
        """Load hooks from config/hooks.yaml and workspace/hooks/ dir."""
        self._webhooks.clear()
        self._pre_hooks.clear()
        self._post_hooks.clear()

        # Static config
        cfg = load_yaml("hooks.yaml")
        for wh in cfg.get("webhooks", []):
            try:
                self._webhooks.append(WebhookConfig(**wh, source="config"))
            except Exception as exc:
                log.warning("Invalid webhook config: %s", exc)

        for ph in cfg.get("pre_hooks", []):
            try:
                self._pre_hooks.append(PrePostHook(**ph))
            except Exception as exc:
                log.warning("Invalid pre_hook config: %s", exc)

        for ph in cfg.get("post_hooks", []):
            try:
                self._post_hooks.append(PrePostHook(**ph))
            except Exception as exc:
                log.warning("Invalid post_hook config: %s", exc)

        # Runtime webhooks from workspace/hooks/ (individual .yaml files, not rules.yaml)
        hooks_dir = settings.workspace_dir / "hooks"
        if hooks_dir.is_dir():
            for f in sorted(hooks_dir.glob("*.yaml")):
                if f.name == "rules.yaml":
                    continue
                try:
                    with open(f) as fh:
                        data = yaml.safe_load(fh) or {}
                    self._webhooks.append(WebhookConfig(**data, source="runtime"))
                except Exception as exc:
                    log.warning("Invalid runtime hook %s: %s", f.name, exc)

        # Runtime rules from workspace/hooks/rules.yaml
        self._load_rules_from_workspace()

        log.info(
            "Hooks loaded: %d webhooks, %d pre-hooks, %d post-hooks",
            len(self._webhooks), len(self._pre_hooks), len(self._post_hooks),
        )

    # ------------------------------------------------------------------
    # Event dispatch
    # ------------------------------------------------------------------

    async def emit(self, event: str, context: dict | None = None):
        """Fire-and-forget dispatch to all webhooks subscribed to this event."""
        ctx = context or {}
        for wh in self._webhooks:
            if not wh.enabled:
                continue
            if event not in wh.events:
                continue
            asyncio.create_task(self._dispatch_webhook(wh, event, ctx))

    async def pre(self, trigger: str, context: dict | None = None) -> dict | None:
        """Run pre-hooks for a trigger. Returns {cancel: True, reason: ...} or None."""
        ctx = context or {}
        for hook in self._pre_hooks:
            if not hook.enabled:
                continue
            if not fnmatch.fnmatch(trigger, hook.trigger):
                continue
            result = await self._run_hook(hook, trigger, ctx)
            if result and result.get("cancel"):
                return result
        return None

    async def post(self, trigger: str, context: dict | None = None):
        """Fire-and-forget post-hooks for a trigger."""
        ctx = context or {}
        for hook in self._post_hooks:
            if not hook.enabled:
                continue
            if not fnmatch.fnmatch(trigger, hook.trigger):
                continue
            asyncio.create_task(self._run_hook(hook, trigger, ctx))

    # ------------------------------------------------------------------
    # Internal dispatch
    # ------------------------------------------------------------------

    async def _dispatch_webhook(self, wh: WebhookConfig, event: str, context: dict):
        """Send a webhook and log the result."""
        ts = datetime.now(timezone.utc).isoformat()
        payload = {"event": event, "timestamp": ts, "data": context}
        try:
            result = await webhook_handler(
                url=wh.url,
                method=wh.method,
                headers=wh.headers,
                payload=payload,
                secret=wh.secret,
                retry=wh.retry,
            )
            _hook_log.append(HookLogEntry(
                timestamp=ts,
                event=event,
                webhook_name=wh.name,
                success=result["success"],
                status_code=result.get("status_code"),
                error=result.get("error"),
                duration_ms=result.get("duration_ms", 0),
            ))
        except Exception as exc:
            _hook_log.append(HookLogEntry(
                timestamp=ts,
                event=event,
                webhook_name=wh.name,
                success=False,
                error=str(exc),
            ))

    async def _run_hook(self, hook: PrePostHook, trigger: str, context: dict) -> dict | None:
        """Execute a pre/post hook handler."""
        ts = datetime.now(timezone.utc).isoformat()
        try:
            if hook.handler == "webhook":
                url = hook.config.get("url", "")
                if not url:
                    return None
                result = await webhook_handler(
                    url=url,
                    method=hook.config.get("method", "POST"),
                    headers=hook.config.get("headers", {}),
                    payload={"trigger": trigger, "timestamp": ts, "data": context},
                    secret=hook.config.get("secret", ""),
                )
                _hook_log.append(HookLogEntry(
                    timestamp=ts,
                    event=trigger,
                    webhook_name=None,
                    success=result["success"],
                    status_code=result.get("status_code"),
                    duration_ms=result.get("duration_ms", 0),
                ))
                return None
            elif hook.handler == "log":
                path = hook.config.get("path", str(settings.workspace_dir / "hooks.log"))
                await log_handler(path, trigger, context)
                return None
        except Exception as exc:
            log.warning("Hook handler error for %s: %s", trigger, exc)
        return None

    # ------------------------------------------------------------------
    # Webhook CRUD (runtime)
    # ------------------------------------------------------------------

    def list_webhooks(self) -> list[dict]:
        return [wh.model_dump() for wh in self._webhooks]

    def add_webhook(self, data: dict) -> WebhookConfig:
        wh = WebhookConfig(**data, source="runtime")
        self._webhooks.append(wh)
        self._persist_runtime_webhook(wh)
        return wh

    def remove_webhook(self, name: str) -> bool:
        before = len(self._webhooks)
        self._webhooks = [wh for wh in self._webhooks if wh.name != name]
        if len(self._webhooks) < before:
            self._delete_runtime_file(name)
            return True
        return False

    async def test_webhook(self, name: str) -> dict:
        wh = next((w for w in self._webhooks if w.name == name), None)
        if not wh:
            return {"error": f"Webhook '{name}' not found."}
        ts = datetime.now(timezone.utc).isoformat()
        payload = {"event": "test", "timestamp": ts, "data": {"message": "Test event from Ray."}}
        return await webhook_handler(
            url=wh.url, method=wh.method, headers=wh.headers,
            payload=payload, secret=wh.secret, retry=wh.retry,
        )

    def _persist_runtime_webhook(self, wh: WebhookConfig):
        hooks_dir = settings.workspace_dir / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)
        path = hooks_dir / f"{wh.name}.yaml"
        data = wh.model_dump(exclude={"source"})
        with open(path, "w") as f:
            yaml.safe_dump(data, f, default_flow_style=False)

    def _delete_runtime_file(self, name: str):
        path = settings.workspace_dir / "hooks" / f"{name}.yaml"
        if path.exists():
            path.unlink()

    # ------------------------------------------------------------------
    # Rule CRUD (runtime pre/post hooks)
    # ------------------------------------------------------------------

    def list_rules(self) -> list[dict]:
        return [r.model_dump() for r in self._pre_hooks + self._post_hooks]

    def add_rule(self, data: dict) -> PrePostHook:
        import uuid
        rule = PrePostHook(**{**data, "id": data.get("id") or str(uuid.uuid4())[:8]})
        if rule.type == "pre":
            self._pre_hooks.append(rule)
        else:
            self._post_hooks.append(rule)
        self._persist_rules()
        return rule

    def remove_rule(self, rule_id: str) -> bool:
        before = len(self._pre_hooks) + len(self._post_hooks)
        self._pre_hooks = [r for r in self._pre_hooks if r.id != rule_id]
        self._post_hooks = [r for r in self._post_hooks if r.id != rule_id]
        removed = (len(self._pre_hooks) + len(self._post_hooks)) < before
        if removed:
            self._persist_rules()
        return removed

    def toggle_rule(self, rule_id: str, enabled: bool) -> bool:
        for rule in self._pre_hooks + self._post_hooks:
            if rule.id == rule_id:
                rule.enabled = enabled
                self._persist_rules()
                return True
        return False

    def _persist_rules(self):
        """Save all runtime rules to workspace/hooks/rules.yaml."""
        hooks_dir = settings.workspace_dir / "hooks"
        hooks_dir.mkdir(parents=True, exist_ok=True)
        rules_path = hooks_dir / "rules.yaml"
        all_rules = [r.model_dump() for r in self._pre_hooks + self._post_hooks]
        with open(rules_path, "w") as f:
            yaml.safe_dump({"rules": all_rules}, f, default_flow_style=False)

    def _load_rules_from_workspace(self):
        """Load runtime rules from workspace/hooks/rules.yaml."""
        rules_path = settings.workspace_dir / "hooks" / "rules.yaml"
        if not rules_path.exists():
            return
        try:
            with open(rules_path) as f:
                data = yaml.safe_load(f) or {}
            for r in data.get("rules", []):
                try:
                    rule = PrePostHook(**r)
                    if rule.type == "pre":
                        self._pre_hooks.append(rule)
                    else:
                        self._post_hooks.append(rule)
                except Exception as exc:
                    log.warning("Invalid rule in rules.yaml: %s", exc)
        except Exception as exc:
            log.warning("Failed to load rules.yaml: %s", exc)

    # ------------------------------------------------------------------
    # Log access
    # ------------------------------------------------------------------

    def get_log(self, limit: int = 100) -> list[dict]:
        entries = list(_hook_log)[-limit:]
        entries.reverse()
        return [e.model_dump() for e in entries]


# Module-level singleton.
hook_engine = HookEngine()


def emit_sync(event: str, context: dict | None = None):
    """Schedule an async emit from synchronous code (e.g. conversation.py)."""
    try:
        loop = asyncio.get_running_loop()
        loop.call_soon_threadsafe(
            lambda: asyncio.ensure_future(hook_engine.emit(event, context or {}))
        )
    except RuntimeError:
        pass
