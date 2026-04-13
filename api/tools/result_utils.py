from __future__ import annotations

from datetime import date, datetime, time
from typing import Any


def make_json_safe(value: Any) -> Any:
    """Recursively coerce values into JSON-safe shapes."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value

    if isinstance(value, (datetime, date, time)):
        return value.isoformat()

    if isinstance(value, dict):
        return {str(key): make_json_safe(item) for key, item in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [make_json_safe(item) for item in value]

    return str(value)


def normalise_tool_result(name: str, result: Any) -> dict:
    """Ensure every tool resolves to a JSON-safe dict payload."""
    if isinstance(result, dict):
        return make_json_safe(result)

    return {
        "error": f"Tool '{name}' returned invalid result type: {type(result).__name__}",
        "result_type": type(result).__name__,
        "raw_result": make_json_safe(result),
    }
