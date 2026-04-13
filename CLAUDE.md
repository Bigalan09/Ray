# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read AGENTS.md first.** It defines the development workflow, testing standards, UI/UX conventions, and documentation requirements that all changes must follow.

## What is Ray

Ray is a local AI personal assistant. Browser-based chat UI (React/Bun) backed by a Python API (FastAPI) with Azure OpenAI and OpenAI Responses API as LLM backends, optional Ollama provider, slash commands, background tasks, cron scheduling, persistent memory, MCP tool integration, and identity files (SOUL.md/USER.md). Runs via Docker Compose on localhost. Also runs as an Electron desktop app loading the same UI.

## Architecture

```
Browser :3000 --> ray-ui (Bun static + /api/* proxy) --> ray-api :8000 (FastAPI)
                                                          |-> OpenAI Responses API (primary)
                                                          |-> Optional direct providers (Azure OpenAI, Ollama)
                                                          |-> Slash commands (/help, /tool, /task, /file, /skill)
                                                          |-> Built-in tools + MCP tools
                                                          |-> SQLite (conversations, tasks) + ChromaDB (memory)
                                                          |-> Background task runner + Cron scheduler
                                                          |-> Security middleware (auth, rate limit, audit)
                                                          |-> YAML config (/config/)

                                                     ray-worker   (background tasks + cron)
                                                     ray-redis    (task queue + rate limiting)
                                                     ray-chromadb (vector memory)
                                                     ray-prometheus / ray-loki / ray-promtail / ray-grafana
                                                       (observability stack, bundled in docker-compose.yml)
```

Optional: `ray-ollama` (uncomment in `docker-compose.yml`).

## Chat Routing

The chat endpoint (`POST /api/chat`) follows this priority:
1. **Slash commands**: If the message starts with `/`, execute the command server-side (no LLM call).
2. **Direct streaming with local agent routing**: Ray always builds a system prompt locally, passes built-in and MCP tools as function definitions, and runs an agent loop that executes tool calls and feeds results back to the model for up to 10 rounds.

## UI Architecture

The React UI uses a `useChat` hook (`ui/src/hooks/useChat.ts`) that encapsulates all chat state and streaming logic:

- **SSE parser** (`hooks/sse-parser.ts`): Buffered line parser handling partial TCP chunks.
- **Event types** (`hooks/sse-events.ts`): Typed discriminated union for all SSE event shapes. `classifyEvent()` maps raw JSON → typed `SSEEvent`. Recognised kinds: `content`, `tool_status`, `citations`, `exec_confirm`, `command_result`, `error`, `timing`.
- **Chat reducer** (`hooks/chat-reducer.ts`): State machine with phases: `idle`, `sending`, `streaming`, `committing`, `error`. Conversation selection is blocked during non-idle phases to prevent race conditions.
- **Platform context** (`context/PlatformContext.tsx`): Detects Electron vs browser via `navigator.userAgent`. Components use `usePlatform()` to adapt (e.g. frameless title bar in desktop mode).

### Exec approval flow

When `/exec` runs: the server sends an `exec_confirm` SSE event → `EXEC_CONFIRM` dispatched → `execPending` set in state → `InputForm` renders the Approve/Deny card (replacing the textarea). The SSE stream closes normally after the `exec_confirm` event. When the user clicks Allow: `approveExec()` clears `execPending` (`EXEC_RESOLVE`), calls `POST /api/exec/approve`, then dispatches `COMMAND_RESULT` with the response body's `content` field so the output appears as an assistant message. Deny follows the same pattern via `POST /api/exec/deny`.

### Sidebar panels

All slide-out panels follow the same pattern: `visible` + `onClose` props, mounted unconditionally in `App.tsx`, toggled via `useState`. Panels: TasksPanel, SchedulePanel, MCPPanel, HooksPanel, MemoryPanel, WorkspacePanel, SkillsPanel, SettingsPanel, ApiKeyPanel. Nav buttons live in `ConversationList.tsx` under "Tools" and "Configure" sections — add `onShow<Panel>` to both `ConversationListProps` and the `App.tsx` call site.

## Build and Run

```bash
# Full stack
docker compose up --build

# Development
cd api && python3.13 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
cd api && .venv/bin/python -m uvicorn main:app --reload --port 8000
cd ui && API_URL=http://localhost:8000 bun run dev
```

Install dependencies before local development:

```bash
cd api && python3.13 -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
cd ui && bun install
cd tests && npm install
```

Docker images use Python 3.12 (`FROM python:3.12-slim`). Local dev can use 3.13; Python 3.14 is too new for the pinned ChromaDB stack.

## Testing

```bash
# All API tests (includes unit, integration, and optional live OpenAI tests)
cd api && .venv/bin/python -m pytest tests/ -v

# Single test
cd api && .venv/bin/python -m pytest tests/test_tools.py::test_calculator_tool_works -v

# E2E (Playwright) against running dev stack
cd tests && npx playwright test

# E2E against live Docker stack (recommended for CI)
cd tests && npx playwright test --config=playwright.docker.config.ts

# API-only (no browser)
cd tests && npx playwright test --config=playwright.api.config.ts

# Repo-level shortcuts
npm run test:e2e
npm run test:e2e:api

# Manual live bootstrap flow only
cd tests && RAY_RUN_BOOTSTRAP_INTERACTIVE=1 npx playwright test e2e/bootstrap-interactive.spec.ts --headed
```

Live integration tests in `test_integration.py` hit the real OpenAI Responses API and auto-skip if `OPENAI_API_KEY` is not set. `bootstrap-interactive.spec.ts` is opt-in unless `RAY_RUN_BOOTSTRAP_INTERACTIVE=1` is set.

Playwright resolves Python by preferring `api/.venv/bin/python`, then `python3.13`, `python3.12`, `python3`. Override with `PYTHON_BIN`.

## Deployment

The production stack lives at `~/deployments/ray/` and builds directly from this repo's source directories. To deploy:

```bash
cd ~/deployments/ray && docker compose up --build -d ray-ui ray-api ray-worker
```

The deployment compose mounts `~/deployments/ray/config/` and `~/deployments/ray/workspace/` as volumes (separate from `./config/` and `./workspace/` in the dev repo). Changes to `config/` in this repo are **not** automatically reflected in the deployment.

## Configuration

YAML in `config/`:
- `models.yaml` -- LLM providers and deployments
- `agents.yaml` -- Ray + internal sub-agent definitions
- `tools.yaml` -- Tool definitions
- `skills.yaml` -- Saved prompt templates for `/skill` command
- `schedules.yaml` -- Cron-scheduled agent tasks
- `instructions.yaml` -- Custom global system instructions (injected into every LLM call)
- `SOUL.md` -- Ray's personality and principles
- `USER.md` -- User profile and preferences
- `BOOTSTRAP.md` -- First-run onboarding template

The default model is set in `config/models.yaml` via `default_model`. The current repo default is `gpt-5-mini` (Azure OpenAI). Both `gpt-5-mini` (Azure) and `gpt-5-nano` (OpenAI direct) are defined. The model switcher dropdown in the header is shown when multiple models are configured; it is hidden for single-model setups.

Workspace/runtime:
- `workspace/mcp_servers.json` -- MCP server configuration (standard `mcpServers` dict format)
- `workspace/IDENTITY.md` -- Ray's self-identity (created during bootstrap)
- `workspace/MEMORY.md` -- Curated memory
- `workspace/api_key` -- Generated API key when auth is enabled
- `workspace/*.db` -- Runtime databases
- `workspace-template/` -- Seed files copied into `workspace/` on first run

## Identity System

`workspace/SOUL.md` defines Ray's personality and principles. `workspace/USER.md` describes the user. `workspace/MEMORY.md` stores curated notes. These workspace files are prepended to the system prompt automatically.

## Memory API

Memory search uses `POST /api/memory/search` with a JSON body `{ "query": "...", "limit": 5 }`. It returns `{ "results": [...], "query": "..." }`. There is no GET variant. `GET /api/memory` lists recent memories. `DELETE /api/memory/{id}` deletes one entry.

## Slash Commands

Type `/` in the chat input to see available commands. The canonical command list comes from `commands.registry.list_commands()` and is exposed at `GET /api/commands`.

### Adding a New Command

1. Add an async handler in `api/commands/builtin.py` (or a new file)
2. Call `register_command(name, handler, description, usage)` from `api/commands/registry.py`
3. Add the module to `_COMMAND_MODULES` in `api/commands/__init__.py`

## Skills

Skills are prompt templates defined in `config/skills.yaml`:
```yaml
skills:
  - name: summarise
    description: Summarise text
    prompt: "Please summarise:\n\n{input}"
    agent: general
```

Invoke via `/skill summarise <text>`. The rendered prompt is sent through the normal LLM path with the specified agent.

## Background Tasks

- `POST /api/tasks` -- Create and run a background agent task
- `POST /api/tasks/parallel` -- Run multiple sub-agent tasks in parallel
- `GET /api/tasks` -- List tasks (filter by status, type)
- `GET /api/tasks/{id}` -- Get task with result
- `POST /api/tasks/{id}/cancel` -- Cancel a task
- `/task <prompt>` -- Create a task from chat

Tasks broadcast status updates via WebSocket (`/ws`). The UI connects to this WebSocket and shows toast notifications when tasks complete or fail. A pill badge on the sidebar Tasks button shows the count of tasks needing attention.

## Security

- **API key auth**: `POST /api/auth/key` creates a key stored in `workspace/api_key`. Pass as `X-API-Key` header. Auth is disabled until a key is generated. `GET /api/auth/status` returns `{ "auth_enabled": bool }` (field is `auth_enabled`, not `enabled`).
- **Rate limiting**: Configurable with `RATE_LIMIT_ENABLED`, `RATE_LIMIT_RPM`, and `RATE_LIMIT_BURST`. Defaults are `1200` req/min and `200` burst. The limiter keys by API key first, then forwarded IP headers, then socket IP. Uses Redis when available, in-memory fallback.
- **Audit logging**: Mutating requests logged to `workspace/audit.db` with sanitised bodies.
- **Middleware**: All three enforced via HTTP middleware in `main.py`. Public paths (`/health`, `/api/auth/*`) bypass auth.
- All ports bound to 127.0.0.1.
- Workspace file access scoped to `/workspace/` directory.

## Exec Guardrails

The `/exec` command and `exec_command` tool allow controlled system command execution. Both paths enforce the same rules:

- **Allowlist-only**: Only commands listed in `config/guardrails.yaml` under `exec.allow` can run.
- **Always confirms**: Every command requires explicit user approval via an inline Approve/Deny card before execution.
- **Sandboxed**: Commands run with `shell=False`, a stripped environment, restricted working directory, and enforced timeouts.

The agent can call `exec_command` as a tool. It returns `approval_required` status; the UI renders a confirmation card. The user must click Approve before the command runs.

Configuration in `config/guardrails.yaml`:
```yaml
exec:
  enabled: true
  default_timeout: 30
  allow:
    - command: git
      args: ["status", "log", "diff"]
      description: "Git read-only operations"
      timeout: 15
```

Backend modules: `api/commands/exec_guardrails.py` (validation), `api/commands/exec_runner.py` (subprocess), `api/commands/exec_pending.py` (pending store + `list_pending()`), `api/commands/exec_cmd.py` (slash command), `api/tools/builtin/exec_tool.py` (agent tool), `api/routers/exec_router.py` (approve/deny/list-pending endpoints).

## Hooks

Event-driven hook system for lifecycle events, webhooks, and pre/post command interception.

- **Webhooks**: HTTP callbacks to external URLs when events fire. Configured in `config/hooks.yaml` (static) or `workspace/hooks/` (runtime, managed via UI or `/hook` command).
- **Pre/post hooks**: Run before/after slash commands or tool calls. Pre-hooks can cancel operations.
- **Events**: `message_received`, `command_executed`, `tool_executing`, `tool_executed`, `response_persisted`, `exec_approved`, `exec_denied`, `task_started`, `task_completed`, `task_failed`, `session_created`, `session_deleted`.
- **UI**: "Webhooks" panel in sidebar for managing runtime webhooks, viewing activity log, and testing.
- **API**: `GET/POST/DELETE /api/hooks/webhooks`, `POST /api/hooks/webhooks/{name}/test`, `GET /api/hooks/events`, `GET /api/hooks/log`.

Backend: `api/hooks/engine.py` (core dispatcher), `api/hooks/models.py`, `api/hooks/handlers.py`, `api/routers/hooks.py`, `api/commands/hooks_cmd.py`.

## Adding a New Tool

1. Create `api/tools/builtin/your_tool.py` with an async function
2. Register in `api/tools/registry.py`
3. Add definition to `config/tools.yaml`
4. Add tool name to relevant agents in `config/agents.yaml`

## Release

Docker images are published to GHCR on every version tag (`v*`) via `.github/workflows/release.yml`. The workflow uses `lower(github.repository_owner)` to normalise the owner to lowercase before constructing the image tag (GHCR requires all-lowercase). Images: `ghcr.io/bigalan09/ray-api` and `ghcr.io/bigalan09/ray-ui`.

## Key Directories

- `api/routers/` -- HTTP endpoints (chat, models, tools, conversations, commands, etc.)
- `api/commands/` -- Slash command registry, built-in commands, file ops, skills
- `api/agents/` -- Agent registry, router, context builder
- `api/llm/` -- OpenAI Responses client, provider abstraction
- `api/tools/` -- Built-in tools + MCP client (auto-restart on crash)
- `api/memory/` -- SQLite conversations + ChromaDB memory
- `api/tasks/` -- Background task store, runner, scheduler
- `api/security/` -- Auth, rate limiting, audit
- `ui/src/components/` -- React components (including CommandAutocomplete)
- `ui/src/hooks/` -- useChat hook, SSE parser, chat state machine, event types
- `ui/src/context/` -- PlatformContext (desktop vs web detection)
- `config/` -- YAML app configuration
- `workspace/` -- Runtime state, identity, API key, MCP config, databases
- `workspace-template/` -- Seed workspace files
