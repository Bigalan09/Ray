"""Browser telemetry endpoint — receives UI events, logs via structlog, updates Prometheus."""
from __future__ import annotations

import structlog
from fastapi import APIRouter
from pydantic import BaseModel

from observability.metrics import ui_events_total, ui_errors_total

log = structlog.get_logger("ray.telemetry")
router = APIRouter()


class UIEvent(BaseModel):
    name: str
    properties: dict = {}
    timestamp: float | None = None


class TelemetryPayload(BaseModel):
    events: list[UIEvent]


@router.post("/telemetry")
async def receive_telemetry(payload: TelemetryPayload):
    for event in payload.events:
        log.info("ui_event", event_name=event.name, **event.properties)
        try:
            ui_events_total.labels(event_name=event.name).inc()
            if event.name == "ui_error":
                error_type = event.properties.get("error_type", "unknown")
                ui_errors_total.labels(error_type=str(error_type)).inc()
        except Exception:
            pass
    return {"accepted": len(payload.events)}
