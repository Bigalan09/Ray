"""Hooks REST API: webhook CRUD, event listing, log access."""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from hooks.engine import hook_engine
from hooks.models import SUPPORTED_EVENTS, INTERNAL_EVENTS, ALL_EVENTS

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
    return {
        "webhook_events": SUPPORTED_EVENTS,
        "internal_events": INTERNAL_EVENTS,
        "all": ALL_EVENTS,
    }


@router.get("/hooks/listeners")
async def list_listeners():
    """Return registered internal hook listeners (pattern -> count)."""
    return hook_engine.listeners()


@router.get("/hooks/log")
async def get_hook_log(limit: int = 100):
    return hook_engine.get_log(limit)


@router.post("/hooks/reload")
async def reload_hooks():
    hook_engine.load_config()
    return {"success": True, "webhooks": len(hook_engine.list_webhooks())}


# --- Pre/Post Rule CRUD ---

class CreateRuleRequest(BaseModel):
    name: str = ""
    type: str = "post"      # "pre" | "post"
    trigger: str = "*"
    handler: str = "log"    # "webhook" | "log"
    enabled: bool = True
    config: dict = {}


@router.get("/hooks/rules")
async def list_rules():
    return hook_engine.list_rules()


@router.post("/hooks/rules", status_code=201)
async def create_rule(req: CreateRuleRequest):
    rule = hook_engine.add_rule(req.model_dump())
    return rule.model_dump()


@router.delete("/hooks/rules/{rule_id}")
async def delete_rule(rule_id: str):
    if hook_engine.remove_rule(rule_id):
        return {"success": True}
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail=f"Rule '{rule_id}' not found.")


@router.patch("/hooks/rules/{rule_id}")
async def toggle_rule(rule_id: str, body: dict):
    if "enabled" not in body:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="enabled field required")
    if hook_engine.toggle_rule(rule_id, body["enabled"]):
        return {"success": True}
    from fastapi import HTTPException
    raise HTTPException(status_code=404, detail=f"Rule '{rule_id}' not found.")
