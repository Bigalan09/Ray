from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from tasks.store import get_task, list_tasks
from security.auth import verify_api_key, _load_api_key

router = APIRouter()

# Connected WebSocket clients
_connections: list[WebSocket] = []


async def broadcast_task_update(task_id: str):
    """Broadcast a task status update to all connected clients."""
    task = get_task(task_id)
    if not task:
        return
    message = json.dumps({"type": "task_update", "task": task})
    disconnected = []
    for ws in _connections:
        try:
            await ws.send_text(message)
        except Exception:
            disconnected.append(ws)
    for ws in disconnected:
        _connections.remove(ws)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, api_key: str | None = Query(None)):
    """WebSocket for real-time task updates and notifications.

    Requires api_key query param if API key auth is enabled.
    Connect as: ws://localhost:8000/ws?api_key=YOUR_KEY
    """
    # Check auth if API key is configured
    stored_key = _load_api_key()
    if stored_key is not None:
        if not api_key or not verify_api_key(api_key):
            await ws.close(code=4001, reason="Invalid or missing API key")
            return

    await ws.accept()
    _connections.append(ws)
    try:
        while True:
            data = await ws.receive_text()
            try:
                msg = json.loads(data)
                msg_type = msg.get("type")

                if msg_type == "ping":
                    await ws.send_text(json.dumps({"type": "pong"}))

                elif msg_type == "subscribe_task":
                    task_id = msg.get("task_id")
                    task = get_task(task_id)
                    if task:
                        await ws.send_text(json.dumps({"type": "task_update", "task": task}))

                elif msg_type == "list_tasks":
                    tasks = list_tasks(limit=20)
                    await ws.send_text(json.dumps({"type": "tasks_list", "tasks": tasks}))

            except json.JSONDecodeError:
                pass
    except WebSocketDisconnect:
        pass
    finally:
        if ws in _connections:
            _connections.remove(ws)
