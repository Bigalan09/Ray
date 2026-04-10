from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from config import settings
from routers import chat, models, prompts, tools, conversations, memory, agents, identity, tasks as tasks_router, ws, documents, commands
from tools.mcp.manager import start_mcp_servers, stop_mcp_servers, get_server_status
from tasks.scheduler import start_scheduler, stop_scheduler, get_scheduled_jobs
from security.auth import generate_api_key, _load_api_key, verify_api_key
from security.rate_limit import check_rate_limit
from security.audit import get_audit_log, log_request

PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc"}
PUBLIC_PREFIXES = ("/api/auth/",)


@asynccontextmanager
async def lifespan(app: FastAPI):
    from bootstrap import ensure_workspace_seeded
    ensure_workspace_seeded()
    try:
        await start_mcp_servers()
    except Exception as e:
        print(f"MCP startup warning: {e}")
    try:
        start_scheduler()
    except Exception as e:
        print(f"Scheduler startup warning: {e}")
    try:
        from hooks.engine import hook_engine
        hook_engine.load_config()
    except Exception as e:
        print(f"Hooks startup warning: {e}")
    yield
    stop_scheduler()
    await stop_mcp_servers()
    from llm.responses import shutdown_client
    await shutdown_client()


app = FastAPI(title="Ray API", version="0.2.0", lifespan=lifespan)

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

from routers import schedules, exec_router, hooks as hooks_router
app.include_router(schedules.router, prefix="/api")
app.include_router(exec_router.router, prefix="/api")
app.include_router(hooks_router.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/mcp/status")
async def mcp_status():
    return get_server_status()


@app.get("/api/scheduler/status")
async def scheduler_status():
    return get_scheduled_jobs()


@app.get("/api/audit")
async def audit_log(limit: int = 100):
    return get_audit_log(limit)


@app.post("/api/auth/generate-key")
async def gen_key():
    existing = _load_api_key()
    if existing:
        return {"error": "API key already exists. Delete workspace/api_key to regenerate."}
    key = generate_api_key()
    return {"api_key": key, "note": "Save this key. It will not be shown again."}


@app.get("/api/auth/status")
async def auth_status():
    return {"auth_enabled": _load_api_key() is not None}
