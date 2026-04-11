# Changelog

All notable changes to Ray are documented here.

## [Unreleased] — 2026-04-11

### Added
- **Workspace file editors** (`WorkspacePanel.tsx`): Sidebar panel with three tabs — Soul, User, Identity — for editing `SOUL.md`, `USER.md`, and `IDENTITY.md` directly in the UI. Lazy-loads each file on first tab visit. Backed by existing `GET/PUT /api/identity/{soul,me,identity}` endpoints.
- **Image attach button**: Dedicated camera button in the input bar opens a native file picker for images. The `<input type="file">` stays in the DOM so Playwright's `setInputFiles()` works in E2E tests. Multi-image parallel attach.
- **Web search citations for function tool**: `web_search` (DuckDuckGo) results now emit `ray_citations` SSE events, so citation cards render in the UI for gpt-5-nano and other models that don't support `web_search_preview`.
- **Proactive memory injection**: `memory_search(last_user_msg, limit=4)` runs before each chat turn. Top hits are injected into the system prompt as a `## Relevant Memory` section so Ray recalls relevant facts without being asked.
- **Memory panel** (`MemoryPanel.tsx`): Sidebar panel with full-text search, paginated result list, and per-entry delete. Accessible via the "Memory" nav button. Backed by `GET /api/memory`, `POST /api/memory/search`, `DELETE /api/memory/{id}`.
- **Model switcher UI**: `<select>` dropdown in the header shows available models (hidden when only one is configured). Selection passes `model` in every `POST /api/chat` request. Backed by `GET /api/models`.
- **Schedule disable**: `PATCH /api/schedules/{name}` endpoint accepts `{enabled: bool}`. Toggles APScheduler live job and persists to `workspace/schedules.yaml`. Panel UI reflects disabled state.
- **Full E2E test suite** (`tests/e2e/full-coverage.spec.ts`): 100+ test cases across 20 describe blocks covering infrastructure/health, bootstrap, chat API, chat UI, slash commands, tools, LLM tool calls (live), web search (live), memory, background tasks, scheduled tasks, webhooks, exec guardrails, conversation CRUD, identity/workspace, MCP, skills, image upload, auth, and error handling. Live-LLM tests auto-skip without `OPENAI_API_KEY`.
- **E2E: exec Approve button UI** (`tests/e2e/exec-approve-ui.spec.ts`): Full flow — `/exec git status` → approval card renders → click Allow → command output in chat. Deny path also tested.
- **E2E: schedule disable** (`tests/e2e/schedule-disable.spec.ts`): Create → disable → verify disabled in list → re-enable → 404 on unknown.
- **E2E: image upload** (`tests/e2e/image-upload.spec.ts`): Attach button visible, preview thumbnail, remove, multiple images, live LLM multimodal test (skips without API key).
- **E2E: RAG pipeline** (`tests/e2e/rag-pipeline.spec.ts`): Upload text/markdown, list ingested docs, search returns results, delete, empty file → 400, `document_search` tool in `/api/tools`.
- **Docker E2E config** (`tests/playwright.docker.config.ts`): Playwright config connecting to a running Docker stack; no web server setup needed. Supports `npm run test:docker` and `npm run test:docker:full`.
- **ISSUES.md**: Full codebase audit listing 33 known issues across P0–P4 with root causes, fix status, and a prioritised fix-order table.
- **GHCR release pipeline** (`.github/workflows/release.yml`): Builds and pushes `ray-api` and `ray-ui` to `ghcr.io/bigalan09/` on version tags and manual dispatch. Multi-arch (`linux/amd64`, `linux/arm64`). Uses GHA layer caching per service.
- **Production compose** (`docker-compose.ghcr.yml`): Compose file referencing pre-built GHCR images. Used by the one-liner installer.
- **One-liner installer** (`install.sh`): `curl -fsSL .../install.sh | bash` — checks Docker, downloads compose + config, scaffolds `.env`, pulls images, starts Ray.

### Changed
- **Ray reframed as general assistant**: Bootstrap onboarding (`workspace-template/BOOTSTRAP.md`) now asks about name, interests, and what the user cares about — not job/role. `SOUL.md` updated to remove work-specific guidance. Agent description and system prompt updated to drop "work assistant" framing.
- **Default model**: Changed from `gpt-5.4-mini` to `gpt-5-nano` in `config/models.yaml`.
- **Rate limiting defaults**: Raised to `1200` req/min, `200` burst (was 120/20) to avoid throttling normal local UI traffic.
- **README**: Completely rewritten — one-liner install, feature status table, updated architecture, GHCR release section, Docker testing commands.

### Fixed
- **LLM tool calls returning "internal error"**: `web_search_preview` was injected into every Responses API request unconditionally. `gpt-5-nano` returns HTTP 400 for this tool. Fixed by `_supports_web_search_preview(model)` in `api/llm/responses.py` — injection is now gated to models that support it.
- **`_KEEPALIVE` dict rebuilt on every bootstrap call**: Was defined inside `event_generator()` scope. Moved to module level.
- **`asyncio.wait` list vs set**: `asyncio.wait([task], ...)` was passing a list; `asyncio.wait` requires a set. Fixed to `asyncio.wait({task}, ...)`.
- **Inner imports inside bootstrap `event_generator()`**: `load_workspace_file` and `_extract_user_name` were imported inside the nested generator function, re-importing on every bootstrap call. Hoisted to top-level.
- **Ollama provider hung UI on error**: The error code path yielded an error SSE but not `[DONE]`, leaving the UI SSE parser waiting indefinitely. Added `yield "data: [DONE]"` before `return`.
- **`web_search_preview` empty tools guard**: Empty `tools` list is no longer passed to the Responses API (was causing unnecessary `tools: []` in the request body).
- **Model capability function syntax**: Standardised `_supports_temperature` and `_supports_web_search_preview` to use `!=` consistently.
- **Citation extraction loop**: Added `break` after detecting `function_call` item type; removed unused `start_index`/`end_index` from citation dicts.
- **Traefik 504 / 404 on ray.bigalan.dev**: Removed invalid Traefik v3 label `responseForwardingFlushInterval` (field does not exist in v3 — caused Traefik to reject the entire service config, producing 404 for all requests).

---

## [0.4.0] — 2026-04-10

### Added
- **Hooks system**: Webhooks, lifecycle events, and pre/post command hooks. 12 events across chat, exec, tasks, and sessions. HTTP callbacks with HMAC-SHA256 signing, retry with backoff. Pre-hooks can cancel operations. Config in `config/hooks.yaml`, runtime webhooks in `workspace/hooks/`. UI panel in sidebar. `/hook` slash command. REST API at `/api/hooks/`.
- **`/clear all` command**: Deletes all sessions. Also available via sidebar "Clear all sessions" button and `DELETE /api/conversations`.
- **AGENTS.md**: Operating manual for AI coding agents. Defines red/green testing workflow, UI/UX conventions, documentation requirements, and the feature checklist.
- **Exec approval in input bar**: The exec confirmation card now replaces the message input area (Claude Code pattern) instead of appearing inline in the chat stream. The agent loop pauses via asyncio Event, waits for approval, then feeds the result back to the model.
- **`/exec` command and `exec_command` tool**: Guardrailed system command execution. Only commands listed in `config/guardrails.yaml` under `exec.allow` can run. Both the slash command and agent tool enforce an inline Approve/Deny confirmation card before execution. Commands run sandboxed: `shell=False`, stripped environment, restricted working directory, enforced timeouts, and capped output.
- **OpenAI Responses API provider**: Ray now uses the OpenAI Responses API as the primary backend. Streaming events normalised into existing Chat Completions-style SSE chunks so the UI and agent loop need no changes.
- **MCP server auto-restart**: Crashed MCP servers restart automatically when a tool call is attempted. Up to 3 retries with backoff. Mid-request failures also trigger a restart and single retry.
- **Rich tool call UI**: Rewritten ToolChips component shows expandable tool call details with arguments, results, and live status. During streaming: "Running filesystem / read_file..." with spinner. Completed calls show collapsible args/result blocks.
- **System prompt capabilities listing**: Auto-generated section listing all available tools (built-in + MCP), skills, and slash commands so the agent knows what it can use.
- **Node.js in API container**: Dockerfile installs Node.js 20 + npm so MCP stdio servers (`npx`) can run inside the container.

### Changed
- **Tool SSE events enriched**: `ray_tool` events now include `arguments` (on "running") and `result` (on "success"/"error"), truncated to 2KB.
- **Chat routing simplified**: Removed Azure AI Foundry `agent_reference` branch. Chat and background tasks now run through the configured provider with one local tool-calling path.
- **Slash command registration**: Commands register through an explicit `register_all_commands()` entry point instead of router import side effects.
- **Playwright support code**: Shared env loading, SSE parsing, and retry helpers live under `tests/support/` instead of being duplicated across specs.
- **Default model**: Switched to `gpt-5-nano` via `config/models.yaml`.
- **Rate limiting defaults**: `1200` req/min, `200` burst.

### Fixed
- **Chat persistence**: Direct chat responses skip persistence when the conversation is missing instead of logging foreign key failures.
- **Hook emission**: `response_persisted` and tool execution hooks no longer fail from an out-of-scope `hook_engine`.
- **Conversation creation failures**: UI stops cleanly when conversation creation fails instead of posting to `/api/conversations/undefined/messages`.

### Removed
- **Dead local action bridge**: Removed the obsolete marker-based local action module.
- **Azure Assistants API code**: `create_thread`, `add_message_to_thread`, `run_assistant_stream`, and related helpers.
- **`azure-ai-projects` dependency**: Replaced by direct OpenAI client with correct base URL.

---

## [0.3.0] — 2026-04-08

### Added
- **Bootstrap enforcement**: BOOTSTRAP.md rules prevent the agent from drifting off-topic during onboarding.
- **Workspace context injection**: Post-bootstrap sessions inject SOUL.md, USER.md, IDENTITY.md, and memory files into the system prompt.
- **Schedule panel UI**: Sidebar "Scheduled" button opens a panel with cron schedules, next-run times, and a "+ New task" modal. Full CRUD via `GET/POST/DELETE /api/schedules`.
- **Tool call notifications**: Structured `ray_tool` SSE events during tool calls (running/success/error). UI shows collapsible "Used N tools" chip above assistant messages.
- **Message action buttons**: Copy and Resend buttons on hover.
- **System prompt viewer**: `{ }` button in the status bar opens a modal with the fully assembled system prompt split into numbered sections. Also at `GET /api/identity/system-prompt`.
- **Task conversations**: Background/scheduled tasks create conversation threads visible under "Automation" in the sidebar.

### Changed
- **`/bootstrap done` output**: Shows `Updated IDENTITY.md, SOUL.md, USER.md.` followed by `Hi {name}, how can I help?` instead of raw markdown file contents.

---

## [0.2.0] — 2026-04-05

### Added
- **`/schedule` command**: Create, list, and remove cron-scheduled tasks from chat. Supports natural language parsing.
- **`/compact` command**: Summarise conversation to reduce token usage.
- **`/file write` command**: Write files to the workspace directory.
- **Image support**: Paste or drag-and-drop images into chat. Sent as base64.
- **Claude-style sidebar**: Time-grouped sessions (Today, Yesterday, Older), hamburger toggle.
- **Security middleware**: Auth (API key via `X-API-Key` header), rate limiting, and audit logging on all non-public routes.
- **Slash commands**: `/help`, `/clear`, `/status`, `/agent`, `/tool`, `/task`, `/file`, `/skill`.
- **Skills system**: Prompt templates in `config/skills.yaml` invocable via `/skill`.
- **UI autocomplete**: `/` in the input shows a dropdown of available commands with keyboard navigation.

---

## [0.1.0] — 2026-04-01

### Added
- Initial release: FastAPI backend, React/Bun UI, Docker Compose stack.
- OpenAI Responses API streaming, SQLite conversations, ChromaDB memory.
- YAML agent config, MCP stdio client, background tasks, cron scheduler.
- Bootstrap onboarding (SOUL.md, USER.md, IDENTITY.md).
- Built-in tools: calculator, get_current_time, web_search, memory_store, memory_search, read_file, write_file, list_files, exec_command.
