"""REST endpoints for scheduled tasks."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from tasks.scheduler import (
    get_scheduled_jobs,
    add_schedule,
    remove_schedule,
    set_schedule_enabled,
    is_valid_cron,
    _read_workspace_schedules,
)

router = APIRouter()


class CreateScheduleRequest(BaseModel):
    name: str
    cron: str
    prompt: str
    agent: str = "general"


@router.get("/schedules")
async def list_schedules():
    """Return all scheduled jobs with their persisted config."""
    jobs = {j["name"]: j for j in get_scheduled_jobs()}
    persisted = _read_workspace_schedules().get("schedules", [])

    result = []
    for s in persisted:
        name = s.get("name", "")
        job = jobs.pop(name, None)
        result.append({
            "name": name,
            "cron": s.get("cron", ""),
            "prompt": s.get("prompt", ""),
            "agent": s.get("agent", "general"),
            "enabled": s.get("enabled", True),
            "next_run": job["next_run"] if job else None,
        })

    # Include any runtime-only jobs not in the persisted file
    for name, job in jobs.items():
        result.append({
            "name": name,
            "cron": "",
            "prompt": "",
            "agent": "general",
            "enabled": True,
            "next_run": job["next_run"],
        })

    return result


@router.post("/schedules")
async def create_schedule(req: CreateScheduleRequest):
    """Create a new scheduled task."""
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Name is required")
    if not req.cron.strip():
        raise HTTPException(status_code=400, detail="Cron expression is required")
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt is required")
    if not is_valid_cron(req.cron):
        raise HTTPException(status_code=400, detail=f"Invalid cron expression: {req.cron}")

    result = add_schedule(req.name.strip(), req.cron.strip(), req.prompt.strip(), req.agent)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@router.patch("/schedules/{name}")
async def update_schedule(name: str, body: dict):
    """Update a schedule — currently supports toggling enabled."""
    if "enabled" not in body:
        raise HTTPException(status_code=400, detail="Only 'enabled' field can be patched")
    result = set_schedule_enabled(name, bool(body["enabled"]))
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.delete("/schedules/{name}")
async def delete_schedule(name: str):
    """Remove a scheduled task."""
    result = remove_schedule(name)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
