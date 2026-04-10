from __future__ import annotations

from datetime import datetime, timezone
from zoneinfo import ZoneInfo


async def get_current_time(timezone: str | None = None, **kwargs) -> dict:
    """Return the current date and time, optionally in a specific timezone."""
    try:
        if timezone:
            tz = ZoneInfo(timezone)
            now = datetime.now(tz)
        else:
            now = datetime.now(ZoneInfo("UTC"))

        return {
            "datetime": now.isoformat(),
            "timezone": timezone or "UTC",
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M:%S"),
            "day_of_week": now.strftime("%A"),
        }
    except Exception as e:
        return {"error": str(e)}
