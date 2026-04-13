"""Tools for managing scheduled tasks."""
from __future__ import annotations


async def list_schedules() -> dict:
    """List all scheduled tasks with their next run times."""
    from tasks.scheduler import get_scheduled_jobs

    jobs = get_scheduled_jobs()
    if not jobs:
        return {"schedules": [], "message": "No scheduled tasks."}
    return {"schedules": jobs}


async def create_schedule(name: str, cron: str, prompt: str, agent: str = "general") -> dict:
    """Create a new scheduled task with a cron expression."""
    from tasks.scheduler import add_schedule, is_valid_cron

    if not is_valid_cron(cron):
        return {"error": f"Invalid cron expression: {cron}. Must be 5 space-separated fields (minute hour day month weekday)."}

    result = add_schedule(name, cron, prompt, agent)
    return result


async def remove_schedule(name: str) -> dict:
    """Remove a scheduled task by name."""
    from tasks.scheduler import remove_schedule as _remove

    result = _remove(name)
    return result
