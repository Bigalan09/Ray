# Ray — Roadmap

Ray is a local-first AI personal assistant. Browser-based chat UI (React/Bun) backed by a Python API (FastAPI) with the OpenAI Responses API as the primary LLM backend. Runs locally via Docker Compose.

## Architecture

```
Browser (localhost:3000)
    |
ray-ui  (Bun static + /api/* proxy)
    |
ray-api  (FastAPI, port 8000)
    |-- OpenAI Responses API  (primary; gpt-5-nano default)
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
- [x] Webhooks panel (manage, test, activity log)
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
- [x] Schedule enable/disable (`PATCH /api/schedules/{name}`, APScheduler live toggle)
- [x] Bootstrap reframed as general assistant (not work assistant); onboarding asks about interests/life, not job/role

### Security & Infrastructure
- [x] Auth middleware (`X-API-Key`; disabled until key generated)
- [x] Rate limiting (Redis-backed with in-memory fallback; configurable via `.env`)
- [x] Audit log (`workspace/audit.db`)
- [x] Exec guardrails (allowlist-only, sandboxed, user-approved)
- [x] Hooks system (webhooks + lifecycle events + pre/post command hooks)
- [x] GHCR release pipeline (multi-arch, version tags)
- [x] One-liner installer (`install.sh`)

### Testing
- [x] API unit + integration tests (148+ tests; live OpenAI auto-skipped without key)
- [x] Full E2E Playwright suite (`full-coverage.spec.ts`; 100+ cases)
- [x] Docker stack E2E config (`playwright.docker.config.ts`)
- [x] E2E: exec Approve button UI full flow (`exec-approve-ui.spec.ts`)
- [x] E2E: schedule disable/re-enable lifecycle (`schedule-disable.spec.ts`)
- [x] E2E: image upload UI + multimodal LLM path (`image-upload.spec.ts`)
- [x] E2E: RAG pipeline upload/search/delete (`rag-pipeline.spec.ts`)

---

## Outstanding

Issues reference [ISSUES.md](ISSUES.md) numbering.

### P2 — Missing UI for Working Backend Features

- [ ] **#10 API key management UI**: No UI to generate, reveal, or rotate the key. Must call `POST /api/auth/generate-key` manually.
- [ ] **#11 MCP server form**: Panel shows status but has no form to add/remove servers.
- [ ] **#12 Settings panel**: No UI for rate limits, exec allow-list, model defaults, or other config.
- [x] **#13 `/agent` slash command**: Registered in `api/commands/builtin.py`. `/agent list` shows agents; `/agent <name>` routes message through named agent.
- [ ] **#14 Skill builder UI**: Skills work via `/skill` but can only be created by editing `config/skills.yaml`.

### P3 — Test Gaps

- [ ] **#16 E2E: proactive memory recall**: Store a fact, start a new conversation, ask a related question, verify it appears without explicit `/tool` call.

### P4 — Code Quality

- [ ] **#33 Pre/post hook UI + tests**: The `pre_command` / `post_command` rule type (can cancel operations) is untested and has no management UI.

---

## Key Design Decisions

**Single agent, single channel**: Ray is one agent with one browser UI. No multi-agent routing, no model-picking complexity for the user. The "general" agent has all tools and adapts its approach to the task.

**OpenAI Responses API first**: Primary backend is the OpenAI Responses API (`responses.create`). Normalised into Chat Completions-style SSE chunks so the UI and agent loop are provider-agnostic. Azure OpenAI and Ollama are optional alternatives.

**Local-first**: All ports bound to 127.0.0.1. No external services required beyond an OpenAI API key. State lives in `workspace/` (SQLite + ChromaDB + identity files).

**YAML config**: Models, agents, tools, schedules, identity. Portable and auditable. No database-backed settings.

**Identity files**: SOUL.md, USER.md, IDENTITY.md, MEMORY.md are injected into every system prompt automatically. These files define Ray's personality, knowledge of the user, and accumulated memory.
