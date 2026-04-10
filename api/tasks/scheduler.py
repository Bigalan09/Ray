from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

import yaml
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config import load_yaml, settings
from tasks.store import create_task

log = logging.getLogger(__name__)
from tasks.runner import run_agent_task


def is_valid_cron(expr: str) -> bool:
    """Check whether *expr* is a valid 5-field cron expression."""
    try:
        CronTrigger.from_crontab(expr)
        return True
    except (ValueError, KeyError):
        return False

_scheduler: AsyncIOScheduler | None = None


def _ws_schedules_path():
    return settings.workspace_dir / "schedules.yaml"


def _read_workspace_schedules() -> dict:
    path = _ws_schedules_path()
    if not path.exists():
        return {"schedules": []}
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
        if raw and isinstance(raw.get("schedules"), list):
            return raw
    except Exception:
        log.warning("Corrupt workspace schedules file, ignoring", exc_info=True)
    return {"schedules": []}


def _write_workspace_schedules(data: dict) -> None:
    _ws_schedules_path().write_text(yaml.dump(data, default_flow_style=False), encoding="utf-8")


def _load_schedules() -> list[dict]:
    """Load scheduled tasks from config and workspace."""
    schedules = []
    config = load_yaml("schedules.yaml")
    schedules.extend(config.get("schedules") or [])
    schedules.extend(_read_workspace_schedules().get("schedules", []))
    return schedules


async def _run_scheduled_task(name: str, prompt: str, agent: str):
    """Execute a scheduled agent task."""
    task = create_task(
        task_type="scheduled",
        prompt=prompt,
        agent=agent,
        metadata={"schedule_name": name, "triggered_at": datetime.now(timezone.utc).isoformat()},
    )
    await run_agent_task(task["id"])


def start_scheduler() -> AsyncIOScheduler:
    """Start the APScheduler with configured cron jobs."""
    global _scheduler
    _scheduler = AsyncIOScheduler()

    schedules = _load_schedules()
    for schedule in schedules:
        if not schedule.get("enabled", True):
            continue

        name = schedule["name"]
        cron = schedule["cron"]
        prompt = schedule["prompt"]
        agent = schedule.get("agent", "general")

        try:
            trigger = CronTrigger.from_crontab(cron)
            _scheduler.add_job(
                _run_scheduled_task,
                trigger=trigger,
                args=[name, prompt, agent],
                id=f"schedule_{name}",
                name=name,
                replace_existing=True,
            )
            log.info("Scheduler: Registered '%s' with cron '%s'", name, cron)
        except Exception as e:
            log.warning("Scheduler: Failed to register '%s': %s", name, e)

    _scheduler.start()
    return _scheduler


def stop_scheduler():
    """Shut down the scheduler."""
    global _scheduler
    if _scheduler:
        _scheduler.shutdown(wait=False)
        _scheduler = None


def get_scheduled_jobs() -> list[dict]:
    """Return info about all scheduled jobs."""
    if not _scheduler:
        return []
    jobs = []
    for job in _scheduler.get_jobs():
        next_run = job.next_run_time
        jobs.append({
            "id": job.id,
            "name": job.name,
            "next_run": next_run.isoformat() if next_run else None,
        })
    return jobs


def add_schedule(name: str, cron: str, prompt: str, agent: str = "general") -> dict:
    """Add a new scheduled task at runtime and persist to workspace schedules file."""
    if not _scheduler:
        return {"error": "Scheduler not running"}

    try:
        trigger = CronTrigger.from_crontab(cron)
        _scheduler.add_job(
            _run_scheduled_task,
            trigger=trigger,
            args=[name, prompt, agent],
            id=f"schedule_{name}",
            name=name,
            replace_existing=True,
        )

        # Persist to workspace schedules file
        _persist_schedule(name, cron, prompt, agent)

        next_run = _scheduler.get_job(f"schedule_{name}")
        next_time = next_run.next_run_time.isoformat() if next_run and next_run.next_run_time else "unknown"
        return {"name": name, "cron": cron, "next_run": next_time}
    except Exception as e:
        return {"error": str(e)}


def remove_schedule(name: str) -> dict:
    """Remove a scheduled task."""
    if not _scheduler:
        return {"error": "Scheduler not running"}
    job_id = f"schedule_{name}"
    try:
        _scheduler.remove_job(job_id)
        _unpersist_schedule(name)
        return {"removed": name}
    except Exception:
        return {"error": f"Schedule '{name}' not found"}


def _persist_schedule(name: str, cron: str, prompt: str, agent: str) -> None:
    """Write schedule to workspace schedules file."""
    data = _read_workspace_schedules()
    data["schedules"] = [s for s in data["schedules"] if s.get("name") != name]
    data["schedules"].append({"name": name, "cron": cron, "prompt": prompt, "agent": agent, "enabled": True})
    _write_workspace_schedules(data)


def _unpersist_schedule(name: str) -> None:
    """Remove a schedule from the workspace schedules file."""
    data = _read_workspace_schedules()
    data["schedules"] = [s for s in data["schedules"] if s.get("name") != name]
    _write_workspace_schedules(data)
