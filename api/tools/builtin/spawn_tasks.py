from __future__ import annotations

import uuid


async def spawn_tasks(tasks: list[dict]) -> dict:
    """Spawn parallel sub-agent tasks. Each task: {prompt, agent?, description?}.

    Runs all tasks concurrently and returns combined results.
    """
    from tasks.runner import run_parallel_subtasks
    parent_id = str(uuid.uuid4())
    results = await run_parallel_subtasks(parent_id, tasks)
    return {"results": results}


async def spawn_agent(prompt: str, agent: str = "general", description: str = "") -> dict:
    """Spawn a single focused sub-agent task and return its result.

    Use this for delegating a self-contained piece of work to a sub-agent
    that runs with its own context. For multiple parallel tasks, use spawn_tasks.
    """
    from tasks.runner import run_parallel_subtasks
    parent_id = str(uuid.uuid4())
    subtask = {"prompt": prompt, "agent": agent}
    if description:
        subtask["metadata"] = {"description": description}
    results = await run_parallel_subtasks(parent_id, [subtask])
    if results and len(results) == 1:
        r = results[0]
        return {"status": r.get("status", "unknown"), "result": r.get("result", ""), "task_id": r.get("id")}
    return {"results": results}
