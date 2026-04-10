# Ray

A local AI personal work assistant. Browser-based chat UI backed by the OpenAI Responses API, with slash commands, skills, background tasks, and an OpenClaw-inspired workspace.

## Quick Start

```bash
# 1. Copy and configure environment
cp .env.example .env
# Edit .env with your OpenAI credentials

# 2. Start everything
docker compose up --build

# 3. Open http://localhost:3000
```

On first run, Ray will guide you through a bootstrap onboarding to set up identity and preferences.

## Local Setup

```bash
# API dependencies
cd api && python -m pip install -r requirements.txt

# UI dependencies
cd ui && bun install

# Playwright test dependencies
cd tests && npm install
```

## Architecture

```
Browser :3000 ─> ray-ui (Bun) ─> ray-api :8000 (FastAPI)
                                   ├─ OpenAI Responses API
                                   ├─ Optional legacy providers (Azure OpenAI, Ollama)
                                   ├─ MCP tools (stdio servers, auto-restart)
                                   ├─ Slash commands (/help, /tool, /task, /file, /skill, /exec)
                                   ├─ Background tasks + cron scheduler
                                   ├─ SQLite (conversations, tasks) + ChromaDB (memory)
                                   ├─ Security (API key auth, rate limiting, audit)
                                   └─ YAML config + workspace files

                                 ray-worker (background tasks + cron)
                                 ray-redis (task queue + rate limiting)
                                 ray-chromadb (vector memory)
```

Five Docker services: `ray-ui`, `ray-api`, `ray-worker`, `ray-redis`, `ray-chromadb`.

## Directory Structure

```
workspace/              Ray's home (mounted as /workspace, NOT in git)
  SOUL.md               Personality and principles
  USER.md               User profile and preferences
  AGENTS.md             Operating manual
  IDENTITY.md           Self-identity (created during bootstrap)
  TOOLS.md              Local tool notes
  MEMORY.md             Curated long-term memory
  memory/YYYY-MM-DD.md  Daily memory logs
  *.db                  Runtime databases

workspace-template/     Templates shipped with the repo (copied on first run)

config/                 App configuration (read-only, in git)
  models.yaml, tools.yaml, skills.yaml, agents.yaml, etc.
```

**The workspace/ directory is not part of the git repo.** It is Ray's personal state. On first startup, template files from `workspace-template/` are copied into `workspace/`. After that, the workspace is entirely Ray's.

**Backup**: Back up `workspace/` and you have Ray's entire state.

**Bootstrap**: On first run (no IDENTITY.md), Ray guides you through a conversational setup. Type `/bootstrap done` to save. Type `/bootstrap reset` to start over.

## Slash Commands

Type `/` in the chat input for autocomplete.
The live command list comes from `/help` and `GET /api/commands`; the table below is the short reference.

| Command | Description |
|---------|-------------|
| `/help` | List all commands |
| `/new` | Start a new session |
| `/clear` | Clear the current session |
| `/compact` | Summarise conversation to save tokens |
| `/status` | System status |
| `/tool [name] [args]` | Execute a tool or list tools |
| `/task [prompt]` | Create a background task (toast notification on completion) |
| `/schedule [cron] [prompt]` | Create a scheduled task (supports natural language, e.g. "daily at 8:30am weekdays") |
| `/schedule list` | List scheduled tasks |
| `/schedule remove [name]` | Remove a scheduled task |
| `/file read\|write\|list\|search` | Workspace file operations |
| `/skill [name] [input]` | Run a saved prompt template |
| `/exec <command>` | Execute a guardrailed system command (requires approval) |
| `/exec list` | Show allowed commands |
| `/hook [list\|add\|remove\|test\|log\|events]` | Manage webhooks |
| `/clear all` | Delete all sessions |
| `/bootstrap done\|reset` | Manage first-run onboarding |

Schedules can also be managed via the **Scheduled** panel in the sidebar, or through the REST API (`GET/POST/DELETE /api/schedules`).

## Skills

Define prompt templates in `config/skills.yaml`:

```yaml
skills:
  - name: summarise
    description: Summarise text
    prompt: "Please summarise:\n\n{input}"
    agent: general
```

Invoke with `/skill summarise <text>`.

## MCP Tools

Ray connects to external tool servers via the [Model Context Protocol](https://modelcontextprotocol.io/). Configure servers in `workspace/mcp_servers.json`:

```json
{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "enabled": true
    }
  ]
}
```

MCP tools are discovered at startup and passed to the LLM as standard function definitions alongside built-in tools. Ray executes tool calls locally and feeds the results back through the same agent loop, while preserving the frontend's existing SSE contract.

Crashed MCP servers are automatically restarted when a tool call is attempted.

The MCP server status panel is accessible from the sidebar.

## Command Execution

Ray can run system commands with strict guardrails. Only commands explicitly allowed in `config/guardrails.yaml` can execute, and every command requires user approval via an inline Approve/Deny card.

```yaml
# config/guardrails.yaml (exec section)
exec:
  enabled: true
  default_timeout: 30
  allow:
    - command: git
      args: ["status", "log", "diff", "branch", "show"]
      description: "Git read-only operations"
      timeout: 15
    - command: npm
      args: ["test", "run", "list"]
      description: "NPM task runner"
      timeout: 120
```

Use `/exec git status` from chat, or the agent can call the `exec_command` tool. Both paths go through the same allowlist and approval gate. Commands run sandboxed with `shell=False`, a stripped environment, and enforced timeouts.

## Webhooks

Ray can notify external systems when events happen (tasks complete, commands run, sessions change). Configure webhooks in `config/hooks.yaml` or manage them at runtime via the Webhooks panel in the sidebar or the `/hook` command.

Supported events: `message_received`, `command_executed`, `tool_executed`, `exec_approved`, `exec_denied`, `task_started`, `task_completed`, `task_failed`, `session_created`, `session_deleted`.

Pre/post hooks can run before/after slash commands or tool calls. Pre-hooks can cancel operations.

## Images

Paste images from clipboard or drag-and-drop onto the chat input. Images are sent to the OpenAI Responses API as inline base64 `input_image` parts.

## Configuration

Copy `.env.example` to `.env` and fill in:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` only if you are routing through an OpenAI-compatible gateway

## Security

- **API key**: `POST /api/auth/generate-key` creates a key. Pass as `X-API-Key` header. Auth disabled until a key is generated.
- **Rate limiting**: 120 req/min, 20 burst per IP.
- **Audit logging**: Mutating requests logged to `workspace/audit.db`.
- All ports bound to `127.0.0.1`.

## Testing

```bash
# API unit tests (including optional live OpenAI integration)
cd api && python -m pytest tests/ -v

# Same E2E commands from repo root
npm run test:e2e
npm run test:e2e:api

# E2E (Playwright, full stack via Docker)
cd tests && npx playwright test

# E2E (API-only, no UI required)
cd tests && npx playwright test --config=playwright.api.config.ts

# Manual live bootstrap flow only
cd tests && RAY_RUN_BOOTSTRAP_INTERACTIVE=1 npx playwright test e2e/bootstrap-interactive.spec.ts --headed
```

## Development

```bash
cd api && uvicorn main:app --reload --port 8000
cd ui && API_URL=http://localhost:8000 bun run dev

# Or use the repo-level shortcuts
npm run ui:dev
npm run docker:up
```
