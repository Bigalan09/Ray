# Changelog

All notable changes to Ray are documented here.

## [Unreleased] - 2026-04-10

### Added
- **Hooks system**: Webhooks, lifecycle events, and pre/post command hooks. 12 events across chat, exec, tasks, and sessions. HTTP callbacks with HMAC-SHA256 signing, retry with backoff. Pre-hooks can cancel operations. Config in `config/hooks.yaml`, runtime webhooks in `workspace/hooks/`. UI panel in sidebar. `/hook` slash command. REST API at `/api/hooks/`.
- **`/clear all` command**: Deletes all sessions. Also available via sidebar "Clear all sessions" button and `DELETE /api/conversations`.
- **AGENTS.md**: Operating manual for AI coding agents. Defines red/green testing workflow, UI/UX standards, documentation requirements, and the feature checklist.
- **Exec approval in input bar**: The exec confirmation card now replaces the message input area (Claude Code pattern) instead of appearing in the chat. The agent loop pauses via asyncio Event, waits for approval, then feeds the result back to the model.
- **`/exec` command and `exec_command` tool**: Guardrailed system command execution. Only commands listed in `guardrails.yaml` under `exec.allow` can run. Both the slash command and agent tool enforce an inline Approve/Deny confirmation card before execution. Commands run sandboxed: `shell=False`, stripped environment, restricted working directory, enforced timeouts, and capped output. The agent can request commands via the `exec_command` tool but cannot bypass the user approval gate.
- **OpenAI Responses provider**: Ray now uses the OpenAI API directly by default. Responses streaming events are normalised into the existing Chat Completions-style SSE chunks so the UI and agent loop do not need a rewrite.
- **MCP server auto-restart**: Crashed MCP servers are automatically restarted when a tool call is attempted. Up to 3 retry attempts with backoff. Mid-request failures also trigger a restart and single retry.
- **Rich tool call UI**: Rewritten ToolChips component shows expandable tool call details with arguments, results, and live status. During streaming, displays "Running filesystem / read_file..." with spinner. Completed calls show collapsible args/result blocks.
- **System prompt capabilities listing**: Auto-generated section in the system prompt listing all available tools (built-in + MCP), skills, and slash commands so the agent knows what it can use.
- **Node.js in API container**: Dockerfile now installs Node.js 20 + npm so MCP stdio servers (npx) can run inside the container.

### Changed
- **Tool SSE events enriched**: `ray_tool` events now include `arguments` (on "running") and `result` (on "success"/"error"), truncated to 2KB for the SSE stream.
- **Chat routing simplified**: Removed the Azure AI Foundry `agent_reference` branch. Chat and background tasks now run through the configured provider with one local tool-calling path.

## 2026-04-08

### Added
- **Bootstrap enforcement**: BOOTSTRAP.md now includes strict rules preventing the agent from going off-topic during onboarding. User messages are wrapped with a bootstrap mode reminder so the LLM cannot drift.
- **Workspace context injection for Azure agents**: Post-bootstrap sessions inject SOUL.md, USER.md, IDENTITY.md, and memory files as a user-assistant pair for Azure AI Foundry agents (which ignore system messages). This fixes new sessions losing personality and context.
- **`build_workspace_context()`**: New prompt builder function that assembles condensed workspace context for non-system-message paths.
- **Bootstrap finalization buffering**: `/bootstrap done` (redirect path) now buffers the LLM response silently and returns a clean command result instead of streaming raw markdown to the UI.
- **E2E tests for bootstrap and session context**: Playwright test suite covering bootstrap done output format, enforcement, identity file access, and session context preservation.

- **Schedule panel UI**: Sidebar "Scheduled" button opens a panel listing all cron schedules with next-run times. "+ New task" modal with name, prompt, frequency presets (hourly, daily, weekdays, weekly, custom cron), and time picker. Full CRUD via `GET/POST/DELETE /api/schedules`.
- **Tool call notifications**: Structured `ray_tool` SSE events during direct streaming tool calls (running/success/error). UI shows collapsible "Used N tools" chip above assistant messages.
- **Message action buttons**: Copy (clipboard with checkmark feedback) and Resend (user messages only) buttons on hover.
- **System prompt viewer**: `{ }` button in the status bar opens a modal showing the fully assembled system prompt split into numbered sections. Also available at `GET /api/identity/system-prompt`.
- **Task conversations**: Background/scheduled tasks create conversation threads visible under "Automation" in the sidebar. Full prompt and result saved as messages.

### Changed
- **Azure config simplified**: `_is_assistants_model()` replaced with `_use_azure_agent()`. No more `assistants: true` flags in models.yaml. Routing is based on project endpoint + agent ID presence. Agent ID must be in `.env` (no longer hardcoded).
- **`/bootstrap done` output**: Now shows `Updated IDENTITY.md, SOUL.md, USER.md.` followed by `Hi {name}, how can I help?` instead of displaying raw markdown file contents in chat.
- **Bootstrap assistant pre-commitment**: The injected assistant message now explicitly states compliance with bootstrap mode and refusal of unrelated questions.

### Previously added
- **Local action bridge**: Post-processes Azure agent responses to detect and execute local actions (memory storage, schedule creation). Bridges the gap between the Azure agent and Ray's local capabilities.
- **`/schedule` command**: Create, list, and remove cron-scheduled tasks from chat. Supports natural language ("daily at 8am") via LLM parsing. Schedules persist to workspace/schedules.yaml.
- **`/compact` command**: Summarise conversation to reduce token usage.
- **Daily memory logs**: Memory now writes to `memory/YYYY-MM-DD.md` files (OpenClaw convention). Prompt builder loads today + yesterday.
- **Context file trimming**: Large workspace files capped at 4000 chars with truncation marker.
- **TOOLS.md and MEMORY.md**: Added to workspace (OpenClaw convention).
- **Workspace separation**: `workspace/` is Ray's personal state (gitignored). `workspace-template/` ships with the repo and seeds on first run.
- **`/file write` command**: Write files to the workspace directory.
- **Azure AI Foundry integration**: Replaced Assistants API with Responses API using `agent_reference`. The agent's model, tools, and instructions are managed in Azure AI Foundry, not locally.
- **Security middleware**: Auth (API key via `X-API-Key` header), rate limiting (120 req/min, 20 burst/sec), and audit logging now enforced on all non-public routes.
- **Slash commands**: Type `/` in chat for interactive commands. Commands are detected before LLM routing and handled server-side.
  - `/help` - List available commands
  - `/clear` - Clear the conversation
  - `/status` - System status (MCP, tasks, scheduler)
  - `/agent [name]` - Switch agent or list agents
  - `/tool [name] [json]` - Execute a tool directly or list tools
  - `/task [prompt]` - Create background tasks from chat
  - `/task status [id]` - Check task status
  - `/task cancel [id]` - Cancel a task
  - `/file read|list|search <path>` - Workspace-scoped file operations
  - `/skill [name] [input]` - Run saved prompt templates
- **Skills system**: Prompt templates in `config/skills.yaml` invocable via `/skill`. Skills redirect rendered prompts through the normal LLM path with the specified agent.
- **UI autocomplete**: Typing `/` in the input shows a dropdown of available commands with keyboard navigation (arrows, Tab, Escape).
- **Tool highlighting**: `**Tool:** name` patterns in messages render with a styled badge.
- **Error handling with retry**: Backend retries transient errors (429, 5xx) with exponential backoff. UI shows error messages with a Retry button.
- **WebSocket task broadcasts**: `broadcast_task_update()` now fires after every task status change (RUNNING, COMPLETED, FAILED).
- **Agent memory**: `data/memory.md` stores session notes and context, loaded into the agent system prompt alongside SOUL.md and ME.md.
- **Structured SSE error events**: `{"type": "error", "message": "...", "retryable": bool}` for frontend error handling.
- **Live integration tests**: 5 tests that hit the real Azure AI Foundry agent, verifying the full pipeline.

### Changed
- **UI simplified**: Removed model and agent selector dropdowns. The Azure agent handles model and routing. Header shows only Ray title, Tasks, MCP, and New Chat.
- **UI consistency**: Extracted CSS custom properties for colours, standardised borders, rounding, button styles, focus states, and typography across all components.
- **Chat payload**: No longer sends `current_agent` or `agent` fields. Backend defaults to auto-routing for direct models, and agent_reference for Azure models.
- **`_is_assistants_model()`**: Now accepts `models_config` parameter (avoids duplicate YAML reads) and checks that `AZURE_EXISTING_AIPROJECT_ENDPOINT` is configured.
- **`_load_schedules()`**: Fixed null handling for empty YAML keys (`config.get("schedules") or []`).
- **Singleton OpenAI client**: Added `shutdown_client()` registered in FastAPI lifespan for clean shutdown.

### Fixed
- **Docker build**: Pinned Bun to 1.2 for `build.onBeforeParse` compatibility. Removed `bunfig.toml` during build to prevent preload conflict.
- **FastAPI/ChromaDB conflict**: Loosened `fastapi` pin to `>=0.115.9,<0.116.0`.
- **SSL certificate error**: Azure OpenAI clients now respect `tls_verify` setting for corporate TLS inspection proxies.
- **UI production server**: `index.tsx` now serves from `dist/` in production mode, fixing blank page on Docker deployment.
- **`.env` API version**: Fixed `AZURE_OPENAI_API_VERSION` which was set to a model name instead of a version string.

- **OpenClaw-aligned bootstrap**: First-run onboarding where Ray discovers its identity through conversational Q&A. Writes IDENTITY.md, SOUL.md, and USER.md to data/.
- **System prompt builder**: Structured prompt assembly from workspace files in OpenClaw order (SOUL, IDENTITY, USER, Safety, Tooling, Memory, Runtime).
- **Identity file overlay**: `data/` overrides `config/` for identity files, fixing Docker read-only mount writes.
- **IDENTITY.md**: New workspace file for agent self-identity (name, vibe, emoji).
- **USER.md**: Renamed from ME.md (OpenClaw convention, backward compat kept).
- **BOOTSTRAP.md**: Onboarding template in config/.
- **Image support**: Paste or drag-and-drop images into chat. Sent as base64 via Azure Responses API `input_image` format.
- **Claude-style sidebar**: Time-grouped sessions (Today, Yesterday, Older), hamburger toggle, actions moved to sidebar.
- **README.md**: Comprehensive project documentation.

### Removed
- Azure Assistants API code (create_thread, add_message_to_thread, run_assistant_stream, etc.)
- `azure-ai-projects` dependency (bypassed in favour of direct OpenAI client with correct base URL)
- Model and agent dropdown components from UI
- `/agent` command (Ray is the single user-facing agent; sub-agents are internal)
