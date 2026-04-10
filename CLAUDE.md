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

## Testing

```bash
# All API tests (includes unit, integration, and optional live OpenAI tests)
cd api && python -m pytest tests/ -v

# Single test
python -m pytest tests/test_tools.py::test_calculator_tool_works -v

# E2E (Playwright)
cd tests && npx playwright test
```

Live integration tests in `test_integration.py` hit the real OpenAI Responses API. They auto-skip if `OPENAI_API_KEY` is not set.

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

Data:
- `data/mcp_servers.json` -- MCP server configuration
- `data/IDENTITY.md` -- Ray's self-identity (created during bootstrap)
- `data/memory.md` -- Agent session memory (auto-maintained, loaded into system prompt)

## Identity System

`config/SOUL.md` defines Ray's personality and principles. `workspace/USER.md` describes the user. `data/memory.md` stores session notes. All three are prepended to every agent's system prompt automatically.

## Slash Commands

Type `/` in the chat input to see available commands. Commands are detected before LLM routing:

- `/help` -- List all commands
- `/new` -- Start a new session
- `/clear` -- Clear the current session
- `/compact` -- Summarise conversation to save tokens
- `/status` -- System status (MCP, tasks, scheduler)
- `/tool [name] [json]` -- Execute a tool or list tools
- `/task [prompt]` -- Create a background task
- `/task status [id]` -- Check task status
- `/task cancel [id]` -- Cancel a task
- `/schedule [cron] [prompt]` -- Create a scheduled task (supports natural language, e.g. "daily at 8:30am on weekdays")
- `/schedule list` -- List scheduled tasks
- `/schedule remove [name]` -- Remove a schedule
- `/file read|write|list|search <path>` -- Workspace file operations
- `/skill [name] [input]` -- Run a saved prompt template
- `/exec <command>` -- Execute a guardrailed system command (requires approval)
- `/exec list` -- Show allowed commands
- `/hook [list|add|remove|test|log|events|reload]` -- Manage webhooks
- `/bootstrap done|reset|status` -- Manage first-run onboarding

### Adding a New Command

1. Add an async handler in `api/commands/builtin.py` (or a new file)
2. Call `register_command(name, handler, description, usage)` from `api/commands/registry.py`
3. Import the module in `api/routers/commands.py` to trigger registration

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

- **API key auth**: `POST /api/auth/generate-key` creates a key stored in `data/api_key`. Pass as `X-API-Key` header. Auth is disabled until a key is generated.
- **Rate limiting**: 120 req/min, 20 burst per IP. Uses Redis when available, in-memory fallback.
- **Audit logging**: Mutating requests logged to `data/audit.db` with sanitised bodies.
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
- `config/` -- All YAML/MD configuration
- `data/` -- Runtime data (databases, API key, memory)
