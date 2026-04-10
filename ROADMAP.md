# Ray — Roadmap

Ray is an AI personal work assistant. It runs locally via Docker Compose with a browser-based chat UI and a Python backend handling agent orchestration, persistent memory, and MCP tool integration.

## Architecture

```
Browser (localhost:3000)
    |
ray-ui (Bun static server + /api/* reverse proxy)
    |
ray-api (FastAPI, port 8000)
    |-- Azure OpenAI Assistants API (threads, code_interpreter, file_search)
    |-- Direct streaming (Anthropic, Ollama, non-assistant Azure models)
    |-- Agent router (keyword + LLM-based)
    |     |-- General agent      -> built-in tools + code_interpreter
    |     |-- Researcher agent   -> web search, memory
    |     |-- Writer agent       -> memory, file tools
    |     |-- Coder agent        -> code_interpreter, memory
    |-- Memory (ChromaDB + SQLite)
    |-- MCP servers (subprocess, stdio transport)
    |-- Background tasks + cron scheduler
    |-- RAG document pipeline

ray-worker (background tasks, cron)
ray-redis (task queue, rate limiting, real-time updates)
ray-chromadb (vector memory + RAG store)
```

### Services

| Service | Build/Image | Host Port | Purpose |
|---------|------------|-----------|---------|
| ray-ui | ./ui (Bun) | 127.0.0.1:3000 | Static React app + proxy to ray-api |
| ray-api | ./api (Python) | 127.0.0.1:8000 | FastAPI: chat, agents, memory, tools |
| ray-worker | ./api | internal | Background tasks, cron scheduler |
| ray-redis | redis:7-alpine | internal | Task queue, rate limiting, pub/sub |
| ray-chromadb | chromadb/chroma | internal | Vector memory + RAG store |

---

## Completed

### Phase 1 — Foundation
- [x] Scaffold, Docker Compose, Dockerfiles, proxy, cherry-picked UI
- [x] FastAPI: chat SSE, models, prompts, tools, Playwright E2E

### Phase 2 — Persistence and Memory
- [x] SQLite conversations, ChromaDB memory, sidebar UI

### Phase 3 — Agent Orchestration
- [x] YAML agents, keyword router, agent context builder, UI selector

### Phase 4 — MCP Servers
- [x] MCP stdio client, server manager, auto-registered tools

### Phase 5 — Multi-Provider LLM
- [x] Azure OpenAI, Anthropic, Ollama providers (all convert to OpenAI SSE)

### Phase 6 — Identity, Tasks, Security
- [x] SOUL.md + ME.md, background tasks, parallel sub-agents, cron, auth, rate limiting, audit

### Phase 7 — Azure OpenAI Assistants API
- [x] Assistants API provider (threads, streaming, code_interpreter)
- [x] Chat endpoint routes assistant-enabled models to Assistants API
- [x] Custom tool calling via Assistants API function calling
- [x] Thread-based conversation support
- [x] File upload via Assistants API (upload, attach to messages)
- [x] Thread-to-conversation sync (map assistant threads to Ray conversations)

---

## Outstanding

### Phase 8 — Critical Fixes

Must be resolved before the system is usable.

- [x] Fix Tailwind CSS compilation in dev mode
- [x] Integration test with real Azure OpenAI (verify SSE end-to-end)
- [x] Fix Anthropic provider tool calling (format differs from OpenAI)
- [x] Store agent name and model on each message in conversations table
- [x] Wire Redis into rate limiting (persistent across restarts)

**Verify**: Styled UI in dev mode. Chat works with Azure and Anthropic. Rate limits persist.

### Phase 9 — Agent Intelligence

- [x] LLM-based fallback routing for ambiguous messages
- [x] Agents auto-update ME.md when they learn user preferences
- [x] SOUL.md refinement: per-agent personality overrides
- [x] WebSocket endpoint for real-time task status updates

**Verify**: Ambiguous messages route correctly. ME.md updates automatically. Task status streams via WebSocket.

### Phase 10 — RAG and Document Pipeline

- [x] Document ingestion endpoint (upload PDF, Word, text, markdown)
- [x] Chunking pipeline (split into retrieval-friendly chunks)
- [x] Store chunks in ChromaDB with source metadata
- [x] RAG retrieval tool for agents
- [x] Workspace file indexing on startup
- [x] Source attribution in responses

**Verify**: Upload a PDF, ask about its content, get cited answer.

### Phase 11 — File Upload and Attachments

- [x] Drag-and-drop file attachments in chat
- [x] Route to Assistants API file_search for assistant models
- [x] Document text extraction for non-assistant models (PDF, Word)
- [x] Image pass-through to vision models
- [x] Attachment preview in message bubbles

**Verify**: Drag a PDF into chat, ask about it. Works with both assistant and non-assistant models.

### Phase 12 — Background Tasks UI

- [x] Tasks panel in UI (list, status, results)
- [x] Real-time status via WebSocket
- [x] Cron schedule viewer
- [x] Cancel running tasks from UI

**Verify**: Start background task, watch real-time progress, view result.

### Phase 13 — MCP Management UI

- [x] MCP server panel (list, status, tools)
- [x] Enable/disable/restart from UI
- [x] Add new server from UI

**Verify**: Enable filesystem MCP from UI, see tools appear.

### Phase 14 — Security Hardening

- [x] Redis-backed rate limiting
- [x] CSRF protection
- [x] Audit log captures request bodies
- [x] MCP environment isolation (whitelist env vars)
- [x] Content filtering for tool outputs

**Verify**: Rate limits persist. MCP servers cannot access .env. Audit shows payloads.

---

## Key Design Decisions

**Assistants API first**: Azure OpenAI models use the Assistants API by default. This gives native thread management, code_interpreter, file_search, and server-side tool execution. Non-assistant models (Anthropic, Ollama) fall back to direct SSE streaming.

**SSE wire format**: All code paths produce OpenAI-compatible SSE chunks. The frontend is provider-agnostic.

**YAML config**: Models, agents, tools, schedules, identity. No database-backed settings UI.

**Identity files**: SOUL.md and ME.md are living documents injected into every agent prompt. Agents update ME.md as they learn.
