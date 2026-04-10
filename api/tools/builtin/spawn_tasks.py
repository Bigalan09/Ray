from __future__ import annotations

import uuid


async def spawn_tasks(tasks: list[dict]) -> dict:
    """Spawn parallel sub-agent tasks. Each task: {prompt, agent (optional)}.

    Runs all tasks concurrently and returns combined results.
    """
    from tasks.runner import run_parallel_subtasks
    parent_id = str(uuid.uuid4())
    results = await run_parallel_subtasks(parent_id, tasks)
    return {"results": results}
