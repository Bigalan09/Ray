# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read AGENTS.md first.** It defines the development workflow, testing standards, UI/UX conventions, and documentation requirements that all changes must follow.

## What is Ray

Ray is a local AI personal work assistant. Browser-based chat UI (React/Bun) backed by a Python API (FastAPI) with the OpenAI Responses API as the primary LLM backend, optional legacy Azure/Ollama providers, slash commands, background tasks, cron scheduling, persistent memory, MCP tool integration, and identity files (SOUL.md/USER.md). Runs via Docker Compose on localhost.

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

                                                     ray-worker (background tasks + cron)
                                                     ray-redis (task queue + rate limiting)
                                                     ray-chromadb (vector memory)
```

Five Docker services: `ray-ui`, `ray-api`, `ray-worker`, `ray-redis`, `ray-chromadb`. Optional `ray-ollama`.

## Chat Routing

The chat endpoint (`POST /api/chat`) follows this priority:
1. **Slash commands**: If the message starts with `/`, execute the command server-side (no LLM call).
2. **Direct streaming with local agent routing**: Ray always builds a system prompt locally, passes built-in and MCP tools as function definitions, and runs an agent loop that executes tool calls and feeds results back to the model for up to 10 rounds.

## Build and Run

```bash
# Full stack
docker compose up --build

# Development
cd api && uvicorn main:app --reload --port 8000
cd ui && API_URL=http://localhost:8000 bun run dev
```

Install dependencies before local development:

```bash
cd api && python -m pip install -r requirements.txt
cd ui && bun install
cd tests && npm install
```

## Testing

```bash
# All API tests (includes unit, integration, and optional live OpenAI tests)
cd api && python -m pytest tests/ -v

# Repo-level Playwright shortcuts
npm run test:e2e
npm run test:e2e:api

# Single test
python -m pytest tests/test_tools.py::test_calculator_tool_works -v

# E2E (Playwright)
cd tests && npx playwright test

# Manual live bootstrap flow only
cd tests && RAY_RUN_BOOTSTRAP_INTERACTIVE=1 npx playwright test e2e/bootstrap-interactive.spec.ts --headed
```

Live integration tests in `test_integration.py` hit the real OpenAI Responses API. They auto-skip if `OPENAI_API_KEY` is not set.
`bootstrap-interactive.spec.ts` is also opt-in and stays out of the default Playwright run unless `RAY_RUN_BOOTSTRAP_INTERACTIVE=1` is set.

## Configuration

YAML in `config/`:
- `models.yaml` -- LLM providers and deployments
- `agents.yaml` -- Ray + internal sub-agent definitions
- `tools.yaml` -- Tool definitions
- `skills.yaml` -- Saved prompt templates for `/skill` command
- `schedules.yaml` -- Cron-scheduled agent tasks
- `SOUL.md` -- Ray's personality and principles
- `USER.md` -- User profile and preferences (formerly ME.md)
- `BOOTSTRAP.md` -- First-run onboarding template

Workspace/runtime:
- `workspace/mcp_servers.json` -- MCP server configuration
- `workspace/IDENTITY.md` -- Ray's self-identity (created during bootstrap)
- `workspace/MEMORY.md` -- Curated memory
- `workspace/api_key` -- Generated API key when auth is enabled
- `workspace/*.db` -- Runtime databases
- `workspace-template/` -- Seed files copied into `workspace/` on first run

## Identity System

`workspace/SOUL.md` defines Ray's personality and principles. `workspace/USER.md` describes the user. `workspace/MEMORY.md` stores curated notes. These workspace files are prepended to the system prompt automatically.

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

- **API key auth**: `POST /api/auth/generate-key` creates a key stored in `workspace/api_key`. Pass as `X-API-Key` header. Auth is disabled until a key is generated.
- **Rate limiting**: 120 req/min, 20 burst per IP. Uses Redis when available, in-memory fallback.
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

Backend modules: `api/commands/exec_guardrails.py` (validation), `api/commands/exec_runner.py` (subprocess), `api/commands/exec_pending.py` (pending store), `api/commands/exec_cmd.py` (slash command), `api/tools/builtin/exec_tool.py` (agent tool), `api/routers/exec_router.py` (approve/deny endpoints).

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
- `config/` -- YAML app configuration
- `workspace/` -- Runtime state, identity, API key, MCP config, databases
- `workspace-template/` -- Seed workspace files
