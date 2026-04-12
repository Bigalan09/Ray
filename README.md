# Ray

A local-first, privacy-respecting AI personal assistant. One agent, one browser UI. Runs entirely on your machine via Docker Compose — no data leaves without your permission.

---

## Install (one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/Bigalan09/Ray/main/install.sh | bash
```

This downloads the compose file, seeds config, and pulls pre-built images from GHCR. You only need Docker installed.

## Manual Setup

```bash
cp .env.example .env
# Set OPENAI_API_KEY in .env
docker compose up --build
open http://localhost:3000
```

On first run Ray guides you through a short onboarding conversation to set up your identity and preferences. Type `/bootstrap done` when finished.

---

## Architecture

```
Browser :3000
    └─ ray-ui  (Bun static + /api/* proxy)
           └─ ray-api :8000  (FastAPI)
                  ├─ OpenAI Responses API  (primary, gpt-5-nano default)
                  ├─ Optional: Azure OpenAI, Ollama
                  ├─ Agent loop: tool calls, multi-round, retries
                  ├─ Slash commands  /help /tool /task /skill /exec /file ...
                  ├─ Built-in tools + MCP stdio servers
                  ├─ SQLite  (conversations, tasks)
                  ├─ ChromaDB  (vector memory)
                  ├─ Background tasks + cron scheduler  ← ray-worker
                  ├─ Webhooks + lifecycle hooks
                  └─ Auth, rate limiting, audit log

ray-worker    background tasks + cron
ray-redis     task queue + rate limiting
ray-chromadb  vector memory
```

Five Docker services: `ray-ui`, `ray-api`, `ray-worker`, `ray-redis`, `ray-chromadb`.  
Optional: `ray-ollama` for local model inference (uncomment in `docker-compose.yml`).

---

## Features

| Feature | Status |
|---------|--------|
| Streaming chat (SSE) | ✅ |
| Multi-turn tool calls (agent loop, up to 10 rounds) | ✅ |
| Web search with citation cards | ✅ `web_search` + `web_search_preview` |
| Persistent conversations (SQLite) | ✅ |
| Auto-generated conversation titles | ✅ |
| Vector memory (ChromaDB) | ✅ store/search + proactive injection per turn |
| Proactive memory recall | ✅ relevant facts injected before each response |
| Memory panel (browse/search/delete) | ✅ |
| Background tasks + WebSocket updates | ✅ |
| Cron-scheduled tasks + enable/disable | ✅ |
| Webhooks + lifecycle hooks | ✅ |
| MCP tool servers (stdio, auto-restart) | ✅ |
| Exec guardrails (allowlist + approval card) | ✅ |
| Image upload + multimodal chat | ✅ paste, drag-drop, or file picker |
| File/PDF RAG ingestion | ✅ chunks embedded in ChromaDB, `document_search` tool |
| Model switching UI | ✅ dropdown in header |
| Workspace file editors (Soul/User/Identity) | ✅ |
| Schedule enable/disable | ✅ |
| Settings panel | ✅ |
| API key management UI | ✅ |
| MCP server management form | ✅ |
| Mobile-responsive UI | ✅ sidebar drawer, 44 px touch targets, dvh layout |
| Browser telemetry (RUM) | ✅ batched events → structlog + Prometheus |
| Response timing display | ✅ shown in status bar |

---

## Slash Commands

Type `/` in the chat input for autocomplete.

| Command | Description |
|---------|-------------|
| `/help` | List all commands |
| `/new` | New session |
| `/clear` | Clear current session |
| `/clear all` | Delete all sessions |
| `/compact` | Summarise conversation to save tokens |
| `/status` | System status (MCP servers, tasks, scheduler) |
| `/tool [name] [args]` | Execute a tool or list tools |
| `/task [prompt]` | Create a background task |
| `/schedule [cron\|natural language] [prompt]` | Schedule a recurring task |
| `/schedule list` | List scheduled tasks |
| `/schedule remove [name]` | Remove a scheduled task |
| `/file read\|write\|list\|search` | Workspace file operations |
| `/skill [name] [input]` | Run a saved prompt template |
| `/exec <command>` | Run an allowlisted system command (requires approval) |
| `/exec list` | Show allowed commands |
| `/hook [list\|add\|remove\|test\|log\|events]` | Manage webhooks |
| `/agent [name]` | Switch to a named agent, or list available agents |
| `/bootstrap done\|reset\|status` | Manage first-run onboarding |

---

## Configuration

### Environment (`.env`)

```bash
cp .env.example .env
```

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `OPENAI_BASE_URL` | No | Override for compatible gateways |
| `RATE_LIMIT_ENABLED` | No | `true`/`false` (default `true`) |
| `RATE_LIMIT_RPM` | No | Requests per minute (default `1200`) |
| `RATE_LIMIT_BURST` | No | Burst size (default `200`) |
| `BRAVE_API_KEY` | No | Enables Brave Search instead of DuckDuckGo |

### Models (`config/models.yaml`)

Default model is `gpt-5-nano`. Add Azure OpenAI or Ollama providers here.

### Workspace (`workspace/`)

Ray's personal state — not in git. Created from `workspace-template/` on first run.

| File | Purpose |
|------|---------|
| `SOUL.md` | Personality and principles |
| `USER.md` | Your profile and preferences |
| `IDENTITY.md` | Ray's self-identity (written during bootstrap) |
| `MEMORY.md` | Curated long-term memory |
| `mcp_servers.json` | MCP server configuration |

Back up `workspace/` to preserve Ray's entire state.

---

## MCP Tools

Configure external tool servers in `workspace/mcp_servers.json`:

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

MCP tools are passed to the LLM alongside built-in tools. Crashed servers are automatically restarted on the next tool call.

---

## Exec Guardrails

Ray can run system commands with strict guardrails. Edit `config/guardrails.yaml`:

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

Every command requires an explicit Approve/Deny from the user before it runs. Commands execute with `shell=False`, a stripped environment, and enforced timeouts.

---

## Webhooks

Ray can notify external systems when events happen. Manage via the Webhooks panel in the sidebar or the `/hook` command.

Supported events: `message_received`, `command_executed`, `tool_executing`, `tool_executed`, `exec_approved`, `exec_denied`, `task_started`, `task_completed`, `task_failed`, `session_created`, `session_deleted`, `response_persisted`.

---

## Skills

Define reusable prompt templates in `config/skills.yaml`:

```yaml
skills:
  - name: summarise
    description: Summarise text
    prompt: "Please summarise:\n\n{input}"
    agent: general
```

Invoke with `/skill summarise <text>`.

---

## Security

- **API key**: Disabled until generated. `POST /api/auth/generate-key` creates a key stored in `workspace/api_key`. Pass as `X-API-Key` header.
- **Rate limiting**: Configurable via `.env`. Defaults to 1200 req/min, 200 burst. Keys by API key → forwarded IP → socket IP.
- **Audit logging**: Mutating requests logged to `workspace/audit.db`.
- **All ports** bound to `127.0.0.1`.
- **Path traversal protection** on all `/file` and workspace operations.

---

## Testing

```bash
# API unit + integration tests (148 tests, live OpenAI auto-skipped if no key)
cd api && python -m pytest tests/ -v

# E2E against local dev stack
cd tests && npm test

# E2E against live Docker stack (recommended for CI)
cd tests && npm run test:docker

# Full coverage suite against Docker stack
cd tests && npm run test:docker:full

# API-only (no browser)
cd tests && npm run test:api
```

---

## Development

```bash
# API (hot reload)
cd api && uvicorn main:app --reload --port 8000

# UI (HMR)
cd ui && API_URL=http://localhost:8000 bun run dev

# Or from repo root
npm run ui:dev
npm run docker:up
```

Install dependencies first:

```bash
cd api && pip install -r requirements.txt
cd ui && bun install
cd tests && npm install
```

---

## Release

Docker images are published to GHCR on every version tag and manual workflow dispatch:

```
ghcr.io/bigalan09/ray-api:latest
ghcr.io/bigalan09/ray-ui:latest
```

To release a new version:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The GitHub Actions workflow builds `linux/amd64` and `linux/arm64` images and pushes them to GHCR automatically.
