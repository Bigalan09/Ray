from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from config import settings
from agents.prompt_builder import load_workspace_file

router = APIRouter()


class IdentityUpdate(BaseModel):
    content: str


def _write_file(name: str, content: str) -> None:
    """Write a file to Ray's workspace."""
    path = settings.workspace_dir / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@router.get("/identity/soul")
async def get_soul():
    return {"content": load_workspace_file("SOUL.md")}


@router.put("/identity/soul")
async def update_soul(req: IdentityUpdate):
    _write_file("SOUL.md", req.content)
    return {"success": True}


@router.get("/identity/me")
async def get_me():
    return {"content": load_workspace_file("USER.md") or load_workspace_file("ME.md")}


@router.put("/identity/me")
async def update_me(req: IdentityUpdate):
    _write_file("USER.md", req.content)
    return {"success": True}


@router.get("/identity/identity")
async def get_identity():
    return {"content": load_workspace_file("IDENTITY.md")}


@router.put("/identity/identity")
async def update_identity(req: IdentityUpdate):
    _write_file("IDENTITY.md", req.content)
    return {"success": True}


@router.get("/identity/bootstrap-status")
async def bootstrap_status():
    from bootstrap import is_bootstrapped, has_existing_identity
    return {
        "bootstrapped": is_bootstrapped(),
        "has_existing_identity": has_existing_identity(),
    }


@router.get("/identity/system-prompt")
async def get_system_prompt(agent: str = "general"):
    """Return the fully assembled system prompt for debugging."""
    from agents.base import build_agent_context
    ctx = build_agent_context(agent)
    return {
        "agent": ctx["agent_name"],
        "prompt": ctx["system_prompt"],
        "temperature": ctx["temperature"],
        "tool_count": len(ctx["tools"]),
    }
