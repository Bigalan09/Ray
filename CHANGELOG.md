# Changelog

All notable changes to Ray are documented here.

## [Unreleased] — 2026-04-13

### Added (latest)
- **API key management UI** (`ApiKeyPanel.tsx`): Sidebar "API Key" panel (Configure section) for generating, rotating, and revoking the API key. Shows auth-enabled status badge, copy-to-clipboard for the generated key, and a one-click revoke with confirmation. Backed by `POST /api/auth/key`, `DELETE /api/auth/key`, `GET /api/auth/status`.
- **`GET /exec/pending`** endpoint: Lists pending exec commands awaiting user approval. Backed by new `list_pending()` helper in `exec_pending.py`.

### Fixed (latest)
- **Exec approval output missing from chat** (issue #43): `approveExec()` discarded the `POST /api/exec/approve` response. Now dispatches `COMMAND_RESULT` with `data.content` so command output appears as an assistant message after clicking Allow.
- **Memory search E2E contract** (issue #44): `full-coverage.spec.ts` called `GET /api/memory/search?q=` but the router only exposes `POST /memory/search`. All three call sites corrected to `POST` with `{ query, limit }` body.
- **Auth status field name** (issue #45): `GET /api/auth/status` returns `auth_enabled`, not `enabled`. Test assertions and skip guards corrected.
- **GHCR image tag case** (release workflow): `lower(github.repository_owner)` normalises the owner to lowercase so image tags like `ghcr.io/Bigalan09/ray-ui:v0.0.3` no longer fail with "repository name must be lowercase".

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

### Added (continued)
- **`/agent` slash command**: `/agent list` shows available agents; `/agent <name>` routes the current message through the named agent. Unknown names return an inline error. `chat.py` extracts `explicit_agent` from redirect results.
- **E2E: agent command** (`tests/e2e/agent-command.spec.ts`): command listed, list output, valid switch, unknown error.
- **Browser telemetry (RUM)**: `ui/src/observability/telemetry.ts` — batched event queue flushed every 2 s or on page unload. Events: `page_load`, `message_sent`, `stream_complete`, `chat_error`, `panel_open`, `ui_error`. `POST /api/telemetry` receives events, logs via structlog (`ray.telemetry`), and increments Prometheus counters `ray_ui_events_total{event_name}` and `ray_ui_errors_total{error_type}`. E2E coverage in `tests/e2e/ui-telemetry.spec.ts`.
- **Response timing in StatusBar**: `responseDuration` state tracked from first SSE chunk to final `ray_metadata` event; shown as `Xs` badge in the status bar with tooltip. Cleared at the start of each new stream.
- **Mobile sidebar drawer** (issue #34): On viewports < 768 px the sidebar renders as a full-height fixed overlay drawer with a semi-transparent backdrop (`data-testid="sidebar-backdrop"`). Clicking the backdrop or selecting a conversation closes it. Desktop collapses to an icon rail.
- **Mobile: 44 px touch targets** (issue #35): Hamburger button and all `SlidePanel` close buttons raised to `min-h-[44px] min-w-[44px]` per WCAG 2.5.5.
- **Mobile: panel width constraint** (issue #36): `SlidePanel` width now uses `min(Xrem, 100vw)` so panels never exceed the viewport on any screen size.
- **Mobile: dynamic viewport height** (issue #37): Root container changed from `h-screen` to `h-[100dvh]` so the chat area resizes correctly when the virtual keyboard opens on iOS/Android.
- **Mobile: StatusBar responsive layout** (issue #38): Token row changed to `flex flex-wrap gap-2`; prompt/completion counts and separators hidden on `xs` screens (`hidden sm:inline`) — only total shown on < 640 px.
- **Mobile: code block overflow** (issue #40): `MessageList` outer container has `min-h-0 overflow-hidden` and message wrappers have `min-w-0 overflow-hidden` so long code blocks scroll horizontally within their container instead of overflowing the page.
- **Mobile: attachment strip overflow badge** (issue #41): Input bar caps visible thumbnails at 2; additional images shown as a `+N` count badge instead of causing overflow.
- **E2E: mobile regression suite** (`tests/e2e/mobile.spec.ts`): 12 tests covering all mobile issues #34–#41 including sidebar drawer behaviour, backdrop, touch targets, panel overflow, dvh class, StatusBar width, code block overflow, and attachment badge.

### Changed
- **UI Tailwind pipeline**: Replaced the Bun preload/plugin path with an explicit Tailwind CLI build/watch step that works on Bun 1.2.21. `bun run dev` now generates `index.generated.css` before starting the dev server, and `bun run build` compiles CSS before bundling.
- **Local Python tooling**: Playwright now resolves a working supported Python interpreter by preferring `api/.venv/bin/python`, then `python3.13`/`python3.12`, instead of assuming a healthy local venv or accepting Python 3.14.
- **Docs synchronised**: README, CLAUDE, ROADMAP, and ISSUES now match the current auth endpoints, implemented UI panels, and completed E2E coverage.
- **Central model capabilities registry**: `_MODEL_CAPS_BLACKLIST` dict in `api/llm/responses.py` replaces two duplicated `gpt-5-nano` hardcodes. Adding a new restricted model now requires one entry.
- **`auto_title()` 10s timeout**: `_llm_title()` wraps the LLM call with `asyncio.wait_for(timeout=10.0)`. Slow/unavailable API calls are cancelled silently; title falls back to "New Chat".
- **Ray reframed as general assistant**: Bootstrap onboarding (`workspace-template/BOOTSTRAP.md`) now asks about name, interests, and what the user cares about — not job/role. `SOUL.md` updated to remove work-specific guidance. Agent description and system prompt updated to drop "work assistant" framing.
- **Default model**: Changed from `gpt-5.4-mini` to `gpt-5-nano`, then to `gpt-5-mini` (Azure OpenAI) in `config/models.yaml`. Both `gpt-5-nano` (OpenAI direct) and `gpt-5-mini` (Azure) are defined; `gpt-5-mini` is the current default.
- **Rate limiting defaults**: Raised to `1200` req/min, `200` burst (was 120/20) to avoid throttling normal local UI traffic.
- **README**: Completely rewritten — one-liner install, feature status table, updated architecture, GHCR release section, Docker testing commands.

### Fixed
- **UI build break on Bun 1.2.21**: Removed the incompatible `bun-plugin-tailwind` dependency on `build.onBeforeParse`, which is not available in the installed Bun version. CSS is now compiled via `@tailwindcss/cli` before Bun serves or bundles the app.
- **Broken local `.venv` fallback**: Playwright startup no longer dies just because `api/.venv` exists but cannot import the Python standard library.
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
