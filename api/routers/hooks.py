"""Hooks REST API: webhook CRUD, event listing, log access."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from hooks.engine import hook_engine
from hooks.models import SUPPORTED_EVENTS

router = APIRouter()


class CreateWebhookRequest(BaseModel):
    name: str
    url: str
    events: list[str] = []
    method: str = "POST"
    headers: dict[str, str] = {}
    secret: str = ""
    enabled: bool = True
    retry_max_attempts: int = 3
    retry_backoff_ms: int = 1000


@router.get("/hooks/webhooks")
async def list_webhooks():
    return hook_engine.list_webhooks()


@router.post("/hooks/webhooks")
async def create_webhook(req: CreateWebhookRequest):
    wh = hook_engine.add_webhook({
        "name": req.name,
        "url": req.url,
        "events": req.events,
        "method": req.method,
        "headers": req.headers,
        "secret": req.secret,
        "enabled": req.enabled,
        "retry": {"max_attempts": req.retry_max_attempts, "backoff_ms": req.retry_backoff_ms},
    })
    return wh.model_dump()


@router.delete("/hooks/webhooks/{name}")
async def delete_webhook(name: str):
    if hook_engine.remove_webhook(name):
        return {"success": True}
    return {"success": False, "error": f"Webhook '{name}' not found."}


@router.post("/hooks/webhooks/{name}/test")
async def test_webhook(name: str):
    return await hook_engine.test_webhook(name)


@router.get("/hooks/events")
async def list_events():
    return SUPPORTED_EVENTS


@router.get("/hooks/log")
async def get_hook_log(limit: int = 100):
    return hook_engine.get_log(limit)


@router.post("/hooks/reload")
async def reload_hooks():
    hook_engine.load_config()
    return {"success": True, "webhooks": len(hook_engine.list_webhooks())}
