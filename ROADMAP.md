# Ray — Roadmap

Ray is an AI personal assistant. Browser-based chat UI (React/Bun) backed by a Python API (FastAPI) with the OpenAI Responses API as the primary LLM backend. Runs locally via Docker Compose.

## Architecture

```
Browser (localhost:3000)
    |
ray-ui  (Bun static + /api/* proxy)
    |
ray-api  (FastAPI, port 8000)
    |-- OpenAI Responses API  (primary; gpt-5-mini default)
    |-- Optional: Azure OpenAI, Ollama providers
    |-- Agent loop  (up to 10 rounds; built-in + MCP tools as function definitions)
    |-- Slash commands  (/help /tool /task /skill /exec /file ...)
    |-- Memory  (SQLite conversations + ChromaDB vector store)
    |-- Background tasks + cron scheduler
    |-- Webhooks + lifecycle hooks
    |-- Security  (auth, rate limiting, audit)
    |-- YAML config  (config/)

ray-worker   (background tasks, cron)
ray-redis    (task queue, rate limiting, pub/sub)
ray-chromadb (vector memory)
```

### Services

| Service | Build/Image | Host Port | Purpose |
|---------|-------------|-----------|---------|
| ray-ui | ./ui (Bun) | 127.0.0.1:3000 | Static React app + proxy to ray-api |
| ray-api | ./api (Python) | 127.0.0.1:8000 | FastAPI: chat, agents, memory, tools |
| ray-worker | ./api | internal | Background tasks, cron scheduler |
| ray-redis | redis:7-alpine | internal | Task queue, rate limiting, pub/sub |
| ray-chromadb | chromadb/chroma | internal | Vector memory |
| ray-prometheus | prom/prometheus | internal | Metrics scraping |
| ray-loki | grafana/loki | internal | Log aggregation |
| ray-promtail | grafana/promtail | internal | Docker log shipper |
| ray-grafana | grafana/grafana | 127.0.0.1:3001 | Dashboards (metrics + logs) |

---

## Completed

### Foundation
- [x] Docker Compose stack (ray-ui, ray-api, ray-worker, ray-redis, ray-chromadb)
- [x] FastAPI backend: streaming chat via SSE, models API, conversations, tools
- [x] React/Bun UI: chat window, sidebar, message bubbles, slash command autocomplete
- [x] SQLite conversations (persistent across restarts)
- [x] ChromaDB vector memory (`memory_store` / `memory_search` tools)

### LLM Providers
- [x] OpenAI Responses API (primary) — streaming, tool calling, `web_search_preview`
- [x] Azure OpenAI provider (direct, not Assistants API)
- [x] Ollama provider (local models, SSE normalisation)
- [x] `web_search_preview` gated to supported models (`_supports_web_search_preview`)

### Agent Loop
- [x] YAML agent definitions (`config/agents.yaml`)
- [x] System prompt builder (SOUL.md, USER.md, IDENTITY.md, MEMORY.md injected automatically)
- [x] Multi-round tool call loop (up to 10 rounds)
- [x] Built-in tools: calculator, get_current_time, web_search, memory_store, memory_search, read_file, write_file, list_files, exec_command
- [x] MCP stdio client with auto-restart on crash

### Identity & Bootstrap
- [x] Bootstrap onboarding — first-run Q&A writes IDENTITY.md, SOUL.md, USER.md
- [x] SSE keepalive pings during bootstrap (prevents proxy timeouts)
- [x] `workspace/` runtime state (gitignored); `workspace-template/` seeds on first run

### Commands & UI
- [x] Slash commands: /help /new /clear /compact /status /tool /task /schedule /file /skill /exec /hook /bootstrap
- [x] Slash command autocomplete with keyboard navigation
- [x] Schedule panel (create/list/delete cron tasks from UI)
- [x] Tasks panel (live status via WebSocket, cancel from UI)
- [x] MCP server panel (list, status, tools)
- [x] MCP server management form (add/remove/restart/enable/disable servers from UI)
- [x] Webhooks panel (manage, test, activity log)
- [x] Hook rules panel (manage pre/post command rules from UI)
- [x] System prompt viewer (`{ }` button in status bar)
- [x] Exec approval card (pauses agent loop; Approve/Deny before command runs)
- [x] Message copy/resend buttons
- [x] Image upload (paste, drag-and-drop, or file picker)
- [x] Citation cards for `web_search_preview` results
- [x] Web search citations for function tool (`web_search` DuckDuckGo → `ray_citations` SSE events)
- [x] Model switcher dropdown in header (backed by `GET /api/models`)
- [x] Memory panel (browse, search, delete entries in sidebar)
- [x] Proactive memory injection per turn (`memory_search` before building system prompt)
- [x] Workspace file editors (Soul/User/Identity tabs in sidebar panel)
- [x] Settings panel (writable logging overrides; read-only model/rate-limit/exec config)
- [x] Skills panel (create/delete workspace skills from UI)
- [x] Schedule enable/disable (`PATCH /api/schedules/{name}`, APScheduler live toggle)
- [x] Bootstrap reframed as general assistant (not work assistant); onboarding asks about interests/life, not job/role
- [x] Structured chat-stream error handling (sanitised SSE errors with request IDs, duplicate UI error collapse, safer tool-result normalisation)

### Concurrency & Reliability
- [x] **AsyncOpenAI native streaming** — `OpenAIResponsesProvider` rewritten to use `AsyncOpenAI` with `async for event in stream:`. Eliminates thread pool exhaustion that caused "Internal Server Error" during concurrent multi-tool-call chains (2N threads → 0 threads per request)
- [x] **Cron scheduling isolated to `ray-worker`** — removed `start_scheduler()` from API lifespan; `ray-worker` is the sole scheduler owner, fixing cron double-fire (every job firing twice)
- [x] **Explicit thread pool** — `ThreadPoolExecutor(max_workers=20)` at API startup replaces the tiny default pool (~6 threads on 2 CPUs in Docker) for ChromaDB/SQLite sync work
- [x] **LLM concurrency semaphore** — `asyncio.Semaphore(10)` in `chat.py` caps simultaneous `stream_chat()` calls; provides backpressure under load
- [x] **Client disconnect detection** — `request.is_disconnected()` checked before each tool-call round; agent chains abort cleanly when the browser tab closes mid-chain
- [x] **Per-round keepalive for tool chains** — `_KEEPALIVE` yielded between tool-call rounds to prevent reverse-proxy timeout on long multi-tool chains
- [x] **Stream timeout** — `asyncio.timeout(300)` hard cap on `_do_stream()`; stalled OpenAI connections fail after 5 minutes with a structured SSE error

### Security & Infrastructure
- [x] Auth middleware (`X-API-Key`; disabled until key generated)
- [x] Rate limiting (Redis-backed with in-memory fallback; configurable via `.env`)
- [x] Audit log (`workspace/audit.db`)
- [x] Exec guardrails (allowlist-only, sandboxed, user-approved)
- [x] Hooks system (webhooks + lifecycle events + pre/post command hooks)
- [x] GHCR release pipeline (multi-arch, version tags)
- [x] One-liner installer (`install.sh`)

### Testing
- [x] API unit + integration tests (169+ tests; live OpenAI auto-skipped without key)
- [x] Full E2E Playwright suite (`full-coverage.spec.ts`; 100+ cases)
- [x] Docker stack E2E config (`playwright.docker.config.ts`)
- [x] E2E: proactive memory recall (`full-coverage.spec.ts`)
- [x] E2E: exec Approve button UI full flow (`exec-approve-ui.spec.ts`)
- [x] E2E: schedule disable/re-enable lifecycle (`schedule-disable.spec.ts`)
- [x] E2E: image upload UI + multimodal LLM path (`image-upload.spec.ts`)
- [x] E2E: RAG pipeline upload/search/delete (`rag-pipeline.spec.ts`)
- [x] E2E: hook rules CRUD (`hook-rules.spec.ts`)
- [x] **API key management UI** (`ApiKeyPanel.tsx`): Sidebar panel for generating, rotating, and revoking the API key. Accessible via "API Key" nav button in the Configure section. Backed by `POST/DELETE /api/auth/key` and `GET /api/auth/status`.
- [x] **Exec approve output rendered in chat**: `approveExec()` now reads the `POST /api/exec/approve` response and dispatches `COMMAND_RESULT` so command output appears in the message list after clicking Allow.
- [x] **E2E contract fixes**: Memory search tests changed from `GET /api/memory/search?q=` to `POST /api/memory/search` (matching the router). Auth status field corrected to `auth_enabled`. `GET /exec/pending` endpoint added.
- [x] **GHCR image tag lowercase**: `lower(github.repository_owner)` applied in release workflow to prevent tag rejection for mixed-case owner names.

---

## Key Design Decisions

**Single agent, single channel**: Ray is one agent with one browser UI. No multi-agent routing, no model-picking complexity for the user. The "general" agent has all tools and adapts its approach to the task.

**OpenAI Responses API first**: Primary backend is the OpenAI Responses API (`responses.create`). Normalised into Chat Completions-style SSE chunks so the UI and agent loop are provider-agnostic. Azure OpenAI and Ollama are optional alternatives.

**Self-hosted**: All ports bound to 127.0.0.1. No external services required beyond an OpenAI API key. State lives in `workspace/` (SQLite + ChromaDB + identity files).

**YAML config**: Models, agents, tools, schedules, identity. Portable and auditable. No database-backed settings.

**Identity files**: SOUL.md, USER.md, IDENTITY.md, MEMORY.md are injected into every system prompt automatically. These files define Ray's personality, knowledge of the user, and accumulated memory.
