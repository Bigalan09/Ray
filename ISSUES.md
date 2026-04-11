# Ray — Known Issues & Feature Gaps

Last updated: 2026-04-11. Generated from full codebase audit.

---

## P0 — Broken / Blocks Use

### 1. LLM tool calls return "internal error" in UI
**Symptom**: Sending a message that triggers a tool call (e.g. "what time is it?", "calculate 2+2") shows an inline error bubble instead of a result.  
**Root cause (confirmed)**: `web_search_preview` was injected into every Responses API request unconditionally. `gpt-5-nano` (the default model) does not support this tool — the API returns a 400 which surfaces as an internal error.  
**Status**: Fixed in `cc5e145`. `_supports_web_search_preview(model)` now gates injection.  
**Test gap**: No E2E test verifies LLM-triggered tool calls end-to-end.

### 2. Chat may show duplicate messages after reload
**Symptom**: After the bootstrap greeting, the trigger message `[starting up for the first time]` was persisted to the DB but not shown in UI state. Selecting the conversation loaded both, making the greeting appear to repeat.  
**Root cause (confirmed)**: `streamResponse` saved all `msgHistory` messages to the DB unconditionally, including the internal bootstrap trigger.  
**Status**: Fixed in `305ccd3`. Bootstrap call now passes `saveMessages=false`.  
**Test gap**: No regression test covering bootstrap → reload → message count.

### 3. `/bootstrap done` gateway timeout on slow LLMs
**Symptom**: First `/bootstrap done` call returns a Traefik 504. Reloading then shows the greeting correctly.  
**Root cause (confirmed)**: `_finalize_bootstrap` buffered the entire LLM response before yielding any SSE — Traefik killed the idle connection.  
**Status**: Fixed in `0d95b1a`. Keepalive pings every 4 s via `asyncio.wait`.  
**Test gap**: No test verifies the keepalive flow under a simulated slow LLM.

---

## P1 — Core Feature Gaps

### 4. Web search citations not rendered in UI
**Symptom**: The `web_search_preview` native tool (for models that support it) and the `web_search` function tool both return results, but no citation cards appear in the chat.  
**Status**: Citation card component added in `e177f45` for `web_search_preview` events (`ray_citations` SSE). Function tool results are not cited.  
**Remaining gap**: `web_search` (DuckDuckGo function tool, used by `gpt-5-nano`) returns markdown text — no structured citations. If the model returns inline URLs they appear as markdown links, not citation cards.  
**Fix needed**: Either (a) parse the `web_search` tool result for URLs and emit `ray_citations`, or (b) return structured `{results: [{url, title, snippet}]}` from the tool and map to `ray_citations` in the SSE stream.

### 5. Memory recall not wired into chat context
**Symptom**: `memory_store` and `memory_search` tools exist and work via `/tool` command, but the LLM does not automatically recall relevant memories before responding.  
**Status**: ChromaDB endpoints work. Proactive injection (plan item 9) was designed but not implemented.  
**Fix needed**: In `_chat_direct()` (`api/routers/chat.py`), run `memory_search(last_user_msg, limit=4)` before building the system prompt and inject results into `build_agent_context()`. See plan `tender-tinkering-sprout.md` § Proactive memory injection.

### 6. PDF / file upload has no RAG ingestion pipeline
**Symptom**: The upload button accepts files. The `/api/documents` endpoint and chunking utilities exist. But uploaded files are never chunked, embedded, or stored in ChromaDB — so they can never be recalled.  
**Status**: `test_rag.py` tests chunking in isolation. `FileUpload` component POSTs to `/api/documents` but backend processor is a stub.  
**Fix needed**: Implement `api/routers/documents.py` — accept upload → split into chunks → embed via ChromaDB → store. Then inject relevant chunks into system prompt on each turn (same as memory injection above).

### 7. Model switching has no UI
**Symptom**: Users cannot change from `gpt-5-nano` to any other configured model without editing `config/models.yaml`.  
**Status**: `GET /api/models` returns all configured models. No dropdown exists in the UI header.  
**Fix needed**: Add a `<select>` or combobox in the Header component; pass `model_id` in the `POST /api/chat` body; wire `resolve_model_provider` to use it.

---

## P2 — Missing UI for Working Backend Features

### 8. Memory panel absent
The full memory API (`/api/memory/search`, `/api/memory/store`, `/api/memory/list`) works. There is no UI to browse, search, or delete memories. Users must use `/tool memory_search {}` from chat.

### 9. Workspace file editors absent
`PUT /api/identity/soul`, `/api/identity/me`, `/api/identity/identity` all work. No UI to edit `SOUL.md` / `USER.md` / `IDENTITY.md`. Users must use `/file write` from chat.

### 10. API key management absent
Auth middleware enforces `X-API-Key` when `workspace/api_key` exists. No UI to generate, reveal, or rotate the key. Users must call `POST /api/auth/generate-key` manually.

### 11. MCP server registration requires manual JSON
`workspace/mcp_servers.json` must be edited by hand. The MCP panel shows server status but has no form to add/remove servers.

### 12. Settings panel missing entirely
No UI for editing rate limits, exec allow-list, model defaults, or any other configuration. Everything requires file edits or raw API calls.

### 13. `/agent` slash command not registered
`agents.yaml` defines `orchestrator` and `curator` agents. The routing logic exists. But `/agent <name>` is not registered in `api/commands/builtin.py`, so there is no way to switch agents from chat.

### 14. Skill builder has no UI
`/skill list` and `/skill <name> <input>` work. Skills can only be created by editing `config/skills.yaml`. No UI form.

---

## P3 — Test Gaps

### 15. No E2E test for LLM-driven tool call flow
Existing tests call `/api/tools/execute` directly. No test sends a natural-language message like "what's 42 * 7?" and verifies the LLM picks `calculator`, streams a `ray_tool` event, and displays the result.

### 16. No E2E test for memory store → recall
No test stores a fact via `memory_store`, then starts a new conversation and asks a related question to verify the fact appears in the response.

### 17. No E2E test for web search end-to-end
No test verifies the full path: user asks a question → LLM triggers `web_search` → results appear in response text.

### 18. No E2E test for image upload → multimodal response
`FileUpload` accepts images. No test uploads an image and verifies the assistant can describe it.

### 19. No E2E test for background task lifecycle
No test creates a task via `/task`, polls until it completes, and verifies the result appears in the tasks panel.

### 20. No E2E test for scheduled task create → list → disable
No test creates a cron schedule, verifies it appears in the Scheduled panel, and disables it.

### 21. No E2E test for auth enforcement
No test generates an API key, then verifies that requests without it return 401.

### 22. No E2E test for exec approval flow (full UI path)
`exec.spec.ts` covers the command parsing. No test sends `/exec git status` from the chat UI and clicks the Approve button.

### 23. No Docker-stack E2E config
All current tests use `reuseExistingServer` against a locally-started dev server. No config exists to run tests against the production Docker stack (`docker compose up`).

### 24. Bootstrap → reload → no duplicates regression
No test verifies that after bootstrap completes and the page is reloaded, only the greeting appears (not the internal trigger).

---

## P4 — Code Quality / Architecture

### 25. Two model capability functions duplicating `gpt-5-nano` knowledge
`_supports_temperature` and `_supports_web_search_preview` in `api/llm/responses.py` both hardcode `"gpt-5-nano"`. If a third capability is added, a third function appears. Should be a central `_MODEL_CAPS` dict.  
**Status**: Syntax inconsistency fixed in `d2a52ed`. Central registry not yet done.

### 26. `auto_title()` LLM call has no timeout
The async `_llm_title()` call fires and forgets. If the OpenAI API is slow or unavailable, the title stays "New Chat" indefinitely. No timeout or fallback is set.

### 27. `_finalize_bootstrap` re-imports inside inner function
`from agents.prompt_builder import load_workspace_file` and `from commands.builtin import _extract_user_name` are imported inside `event_generator()`. These should be top-level imports.

### 28. `OllamaProvider.stream_chat` does not emit `[DONE]` on error path
If the Ollama HTTP call fails before the `for` loop, the function yields an error SSE and returns — but never yields `data: [DONE]`. The UI's SSE parser waits for `[DONE]` to finalize the message, leaving it stuck.

### 29. `asyncio.wait` called with a list, not a set
`asyncio.wait([task], timeout=4)` in `chat.py` constructs a new `list` each iteration. `asyncio.wait` requires an awaitable set — it converts internally but this is wasteful. Pass `{task}`.

### 30. Pre/post command hook rules have no UI and no test coverage
The hook engine emits all events. Webhook CRUD is UI-visible and tested. But the `pre_command` / `post_command` rule type (which can cancel operations) is untested and has no management UI.

---

## Ordered Fix Plan

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | LLM tool call errors (#1) | Fixed ✓ | Blocking |
| P0 | Duplicate bootstrap messages (#2) | Fixed ✓ | Blocking |
| P0 | Bootstrap SSE timeout (#3) | Fixed ✓ | Blocking |
| P1 | Memory proactive injection (#5) | Medium | High |
| P1 | Web search citation for function tool (#4) | Small | Medium |
| P1 | PDF RAG pipeline (#6) | Large | Medium |
| P1 | Model switcher UI (#7) | Small | High |
| P2 | Memory panel UI (#8) | Medium | Medium |
| P2 | Workspace file editors (#9) | Small | Low |
| P2 | API key management UI (#10) | Small | Low |
| P2 | MCP server form (#11) | Medium | Low |
| P3 | Full E2E test suite (#15–24) | Large | High |
| P4 | Ollama `[DONE]` on error (#28) | Tiny | Low |
| P4 | Import hoisting (#27) | Tiny | Low |
| P4 | asyncio.wait set (#29) | Tiny | Low |
