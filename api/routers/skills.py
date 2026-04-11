"""Skills CRUD API — list built-in skills and manage user-created ones."""
from __future__ import annotations

from pathlib import Path

import yaml
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from config import settings, load_yaml

router = APIRouter()

_WORKSPACE_SKILLS = settings.data_dir / "skills.yaml"


def _load_builtin_skills() -> list[dict]:
    return load_yaml("skills.yaml").get("skills", [])


def _load_workspace_skills() -> list[dict]:
    if not _WORKSPACE_SKILLS.exists():
        return []
    with open(_WORKSPACE_SKILLS) as f:
        data = yaml.safe_load(f) or {}
    return data.get("skills", [])


def _save_workspace_skills(skills: list[dict]) -> None:
    _WORKSPACE_SKILLS.parent.mkdir(parents=True, exist_ok=True)
    with open(_WORKSPACE_SKILLS, "w") as f:
        yaml.safe_dump({"skills": skills}, f, allow_unicode=True, sort_keys=False)


def _merged_skills() -> list[dict]:
    """Workspace skills override built-ins with the same name."""
    builtin = _load_builtin_skills()
    workspace = _load_workspace_skills()
    ws_names = {s["name"] for s in workspace}
    # Built-ins not overridden by workspace, then workspace skills
    return [s for s in builtin if s["name"] not in ws_names] + workspace


class SkillCreate(BaseModel):
    name: str
    description: str = ""
    prompt: str
    agent: str = "general"


@router.get("/skills")
async def list_skills():
    builtin = _load_builtin_skills()
    workspace = _load_workspace_skills()
    builtin_names = {s["name"] for s in builtin}
    ws_names = {s["name"] for s in workspace}
    merged = [s for s in builtin if s["name"] not in ws_names] + workspace
    return {"skills": [{**s, "builtin": s["name"] in builtin_names and s["name"] not in ws_names} for s in merged]}


@router.post("/skills", status_code=201)
async def create_skill(body: SkillCreate):
    name = body.name.strip().lower().replace(" ", "-")
    if not name or not body.prompt.strip():
        raise HTTPException(status_code=400, detail="name and prompt are required")

    workspace = _load_workspace_skills()
    # Update if already exists in workspace, else append
    existing_idx = next((i for i, s in enumerate(workspace) if s["name"] == name), None)
    skill = {"name": name, "description": body.description, "prompt": body.prompt, "agent": body.agent}
    if existing_idx is not None:
        workspace[existing_idx] = skill
    else:
        workspace.append(skill)
    _save_workspace_skills(workspace)
    return skill


@router.delete("/skills/{name}")
async def delete_skill(name: str):
    workspace = _load_workspace_skills()
    new_workspace = [s for s in workspace if s["name"] != name]
    if len(new_workspace) == len(workspace):
        # Not in workspace — check if it's a built-in
        builtin_names = {s["name"] for s in _load_builtin_skills()}
        if name in builtin_names:
            raise HTTPException(status_code=403, detail="Cannot delete a built-in skill. Create a workspace override to replace it.")
        raise HTTPException(status_code=404, detail=f"Skill '{name}' not found.")
    _save_workspace_skills(new_workspace)
    return {"deleted": True, "name": name}
