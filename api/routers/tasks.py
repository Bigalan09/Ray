from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel

from tasks.store import create_task, get_task, list_tasks, cancel_task, TaskStatus
from tasks.runner import run_agent_task, run_parallel_subtasks

router = APIRouter()


class CreateTaskRequest(BaseModel):
    prompt: str
    agent: str = "general"
    task_type: str = "background"
    metadata: dict | None = None


class ParallelTaskRequest(BaseModel):
    subtasks: list[dict]
    metadata: dict | None = None


@router.post("/tasks")
async def create_and_run_task(req: CreateTaskRequest, background_tasks: BackgroundTasks):
    """Create a background agent task and start it immediately."""
    task = create_task(
        task_type=req.task_type,
        prompt=req.prompt,
        agent=req.agent,
        metadata=req.metadata,
    )
    # Run in background
    background_tasks.add_task(_run_task_async, task["id"])
    return task


@router.post("/tasks/parallel")
async def create_parallel_tasks(req: ParallelTaskRequest, background_tasks: BackgroundTasks):
    """Create a parent task with parallel subtasks."""
    parent = create_task(
        task_type="parallel",
        prompt=f"Parallel execution of {len(req.subtasks)} subtasks",
        metadata=req.metadata,
    )

    async def _run():
        from tasks.store import update_task_status
        update_task_status(parent["id"], TaskStatus.RUNNING)
        try:
            results = await run_parallel_subtasks(parent["id"], req.subtasks)
            import json
            update_task_status(parent["id"], TaskStatus.COMPLETED, result=json.dumps(results))
        except Exception as e:
            update_task_status(parent["id"], TaskStatus.FAILED, error=str(e))

    background_tasks.add_task(_run_async, _run)
    return parent


@router.get("/tasks")
async def list_all_tasks(status: str | None = None, type: str | None = None, limit: int = 50):
    return list_tasks(status=status, task_type=type, limit=limit)


@router.get("/tasks/{task_id}")
async def get_task_detail(task_id: str):
    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.post("/tasks/{task_id}/cancel")
async def cancel(task_id: str):
    if not cancel_task(task_id):
        raise HTTPException(status_code=404, detail="Task not found")
    return {"success": True}


@router.get("/tasks/{task_id}/subtasks")
async def get_subtasks(task_id: str):
    return list_tasks(parent_id=task_id)


async def _run_task_async(task_id: str):
    """Wrapper to run async task from background task."""
    await run_agent_task(task_id)


async def _run_async(coro_fn):
    """Wrapper to run an async function from background task."""
    await coro_fn()
