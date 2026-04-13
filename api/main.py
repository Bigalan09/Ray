from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from config import settings
from routers import chat, models, prompts, tools, conversations, memory, agents, identity, tasks as tasks_router, ws, documents, commands, telemetry as telemetry_router
from tools.mcp.manager import start_mcp_servers, stop_mcp_servers, get_server_status
from tasks.scheduler import get_scheduled_jobs
from security.auth import generate_api_key, _load_api_key, verify_api_key
from security.rate_limit import check_rate_limit
from security.audit import get_audit_log, log_request
from observability.setup import configure_logging, get_log_config
from observability.middleware import ObservabilityMiddleware

PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc", "/metrics"}
PUBLIC_PREFIXES = ("/api/auth/",)

configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    loop = asyncio.get_running_loop()
    loop.set_default_executor(ThreadPoolExecutor(max_workers=20, thread_name_prefix="ray-io"))

    from bootstrap import ensure_workspace_seeded
    ensure_workspace_seeded()
    try:
        await start_mcp_servers()
    except Exception as e:
        print(f"MCP startup warning: {e}")
    try:
        from hooks.engine import hook_engine
        hook_engine.load_config()
        await hook_engine.emit("gateway:startup", {})
    except Exception as e:
        print(f"Hooks startup warning: {e}")
    yield
    await stop_mcp_servers()
    from llm.responses import shutdown_client, shutdown_async_client
    await shutdown_client()
    await shutdown_async_client()


app = FastAPI(title="Ray API", version="0.2.0", lifespan=lifespan)

app.add_middleware(ObservabilityMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def _is_public(path: str) -> bool:
    return path in PUBLIC_PATHS or any(path.startswith(p) for p in PUBLIC_PREFIXES)


@app.middleware("http")
async def security_middleware(request: Request, call_next):
    path = request.url.path
    start = time.time()

    if not _is_public(path):
        # Auth check
        stored_key = _load_api_key()
        if stored_key is not None:
            provided = request.headers.get("x-api-key", "")
            if not verify_api_key(provided):
                return JSONResponse(status_code=401, content={"detail": "Invalid or missing API key"})

        # Rate limiting
        try:
            check_rate_limit(request)
        except Exception as exc:
            return JSONResponse(status_code=429, content={"detail": str(exc.detail) if hasattr(exc, "detail") else "Rate limit exceeded"})

    response = await call_next(request)

    # Audit logging for mutating requests
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and not _is_public(path):
        duration_ms = (time.time() - start) * 1000
        ip = request.client.host if request.client else "unknown"
        ua = request.headers.get("user-agent")
        try:
            body = (await request.body()).decode("utf-8", errors="replace")[:2000]
        except Exception:
            body = None
        log_request(request.method, path, ip, response.status_code, duration_ms, ua, body)

    return response


app.include_router(chat.router, prefix="/api")
app.include_router(models.router, prefix="/api")
app.include_router(prompts.router, prefix="/api")
app.include_router(tools.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(memory.router, prefix="/api")
app.include_router(agents.router, prefix="/api")
app.include_router(identity.router, prefix="/api")
app.include_router(tasks_router.router, prefix="/api")
app.include_router(ws.router)
app.include_router(documents.router, prefix="/api")
app.include_router(commands.router, prefix="/api")

from routers import schedules, exec_router, hooks as hooks_router, skills as skills_router, settings as settings_router
app.include_router(schedules.router, prefix="/api")
app.include_router(exec_router.router, prefix="/api")
app.include_router(hooks_router.router, prefix="/api")
app.include_router(skills_router.router, prefix="/api")
app.include_router(settings_router.router, prefix="/api")
app.include_router(telemetry_router.router, prefix="/api")

from routers import admin as admin_router
app.include_router(admin_router.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint. Disable by setting metrics_path: '' in config/logging.yaml."""
    cfg = get_log_config()
    metrics_path = cfg.get("metrics_path", "/metrics")
    if not metrics_path:
        return JSONResponse(status_code=404, content={"detail": "Metrics disabled"})
    from prometheus_client import generate_latest, CONTENT_TYPE_LATEST
    from observability.metrics import REGISTRY
    return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


@app.get("/api/mcp/status")
async def mcp_status():
    return get_server_status()


@app.post("/api/mcp/servers")
async def add_mcp_server(body: dict):
    from tools.mcp.manager import add_mcp_server as _add
    name = body.get("name", "").strip()
    command = body.get("command", "").strip()
    if not name or not command:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="name and command are required")
    server_def = {
        "name": name,
        "command": command,
        "args": body.get("args", []),
        "enabled": body.get("enabled", True),
    }
    if body.get("env"):
        server_def["env"] = body["env"]
    return await _add(server_def)


@app.delete("/api/mcp/servers/{name}")
async def remove_mcp_server(name: str):
    from tools.mcp.manager import remove_mcp_server as _remove
    return await _remove(name)


@app.patch("/api/mcp/servers/{name}")
async def toggle_mcp_server(name: str, body: dict):
    from tools.mcp.manager import toggle_mcp_server as _toggle
    if "enabled" not in body:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="enabled field required")
    return await _toggle(name, body["enabled"])


@app.post("/api/mcp/servers/{name}/restart")
async def restart_mcp_server(name: str):
    from tools.mcp.manager import _restart_server
    success = await _restart_server(name)
    return {"success": success, "name": name}


@app.get("/api/scheduler/status")
async def scheduler_status():
    return get_scheduled_jobs()


@app.get("/api/audit")
async def audit_log(limit: int = 100):
    return get_audit_log(limit)


@app.post("/api/auth/key")
async def create_key(force: bool = False):
    existing = _load_api_key()
    if existing and not force:
        from fastapi import HTTPException
        raise HTTPException(status_code=409, detail="API key already exists. Use ?force=true to rotate.")
    key = generate_api_key()
    return {"api_key": key, "note": "Save this key. It will not be shown again."}


@app.post("/api/auth/generate-key")
async def gen_key():
    """Legacy endpoint — kept for backwards compatibility."""
    existing = _load_api_key()
    if existing:
        return {"error": "API key already exists. Use DELETE /api/auth/key then POST to regenerate."}
    key = generate_api_key()
    return {"api_key": key, "note": "Save this key. It will not be shown again."}


@app.delete("/api/auth/key")
async def revoke_key():
    key_file = settings.data_dir / "api_key"
    if not key_file.exists():
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=404, content={"error": "No API key exists."})
    key_file.unlink()
    return {"revoked": True}


@app.get("/api/auth/status")
async def auth_status():
    return {"auth_enabled": _load_api_key() is not None}
