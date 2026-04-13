# Ray — Known Issues & Feature Gaps

Last updated: 2026-04-13. Generated from full codebase audit + E2E gap review.

---

## P0 — Broken / Blocks Use

### 1. LLM tool calls return "internal error" in UI
**Symptom**: Sending a message that triggers a tool call (e.g. "what time is it?", "calculate 2+2") shows an inline error bubble instead of a result.  
**Root cause (confirmed)**: `web_search_preview` was injected into every Responses API request unconditionally. `gpt-5-nano` (the default model) does not support this tool — the API returns a 400 which surfaces as an internal error.  
**Status**: Fixed in `cc5e145`. `_supports_web_search_preview(model)` now gates injection.  
**Test gap**: Covered in full-coverage.spec.ts §7 "LLM tool calls (live)".

### 2. Chat may show duplicate messages after reload
**Symptom**: After the bootstrap greeting, the trigger message `[starting up for the first time]` was persisted to the DB but not shown in UI state. Selecting the conversation loaded both, making the greeting appear to repeat.  
**Root cause (confirmed)**: `streamResponse` saved all `msgHistory` messages to the DB unconditionally, including the internal bootstrap trigger.  
**Status**: Fixed in `305ccd3`. Bootstrap call now passes `saveMessages=false`.  
**Test**: Covered in full-coverage.spec.ts "bootstrap doesn't persist trigger message".

### 3. `/bootstrap done` gateway timeout on slow LLMs
**Symptom**: First `/bootstrap done` call returns a Traefik 504. Reloading then shows the greeting correctly.  
**Root cause (confirmed)**: `_finalize_bootstrap` buffered the entire LLM response before yielding any SSE — Traefik killed the idle connection.  
**Status**: Fixed in `0d95b1a`. Keepalive pings every 4 s via `asyncio.wait`.  
**Test gap**: No test verifies keepalive flow under a simulated slow LLM.

---

## P1 — Core Feature Gaps

### 4. Memory recall not wired into chat context
**Status**: Fixed. `memory_search(last_user_msg, limit=4)` runs before each turn in `chat.py`. Results are injected via `build_agent_context(injected_memories=...)` and appear as a `## Relevant Memory` section in the system prompt.

### 5. Memory panel absent
**Status**: Fixed. `ui/src/components/MemoryPanel.tsx` — sidebar panel with search input, paginated result list, and per-entry delete. Accessible via the "Memory" nav button. Backed by GET `/api/memory`, POST `/api/memory/search`, DELETE `/api/memory/{id}`.

### 6. Web search citations not rendered for function tool results
**Status**: Fixed. `web_search` already returned `{results: [{url, title, snippet}]}`. Added `ray_citations` SSE emission in `_do_stream()` after each `web_search` tool call — same format as `web_search_preview` so citation cards render for gpt-5-nano too.

### 7. PDF / file upload has no RAG ingestion pipeline
**Status**: Fixed. `api/routers/documents.py` now ingests uploaded files, extracts text, stores chunks in ChromaDB, and exposes list/search/delete endpoints. Covered by `tests/e2e/rag-pipeline.spec.ts`.

### 8. Model switching has no UI
**Status**: Fixed. `Header.tsx` now shows a `<select>` dropdown when multiple models are configured (hidden for single-model setups). Selection updates `selectedModel` state in `App.tsx` which is passed in every `POST /api/chat` call. Backed by existing `GET /api/models` and `resolve_model_provider`.

---

## P2 — Missing UI for Working Backend Features

### 9. Workspace file editors absent
**Status**: Fixed. `WorkspacePanel.tsx` — three-tab panel (Soul / User / Identity) with load, edit, and save. Accessible via the "Workspace" nav button. Backed by existing `GET/PUT /api/identity/{soul,me,identity}` endpoints.

### 10. API key management absent
**Status**: Still open. The backend routes exist (`POST /api/auth/key`, legacy `POST /api/auth/generate-key`, `DELETE /api/auth/key`), but auth is still managed through the API only. `ui/src/components/ApiKeyPanel.tsx` exists, yet it is not mounted from `App.tsx`, and `tests/e2e/api-key-management.spec.ts` explicitly skips the UI coverage.

### 11. MCP server registration requires manual JSON
**Status**: Fixed. `MCPPanel.tsx` now includes an add-server form (name, command, args), per-server enable/disable and restart buttons, and a remove button. Backed by existing `POST/DELETE/PATCH /api/mcp/servers` endpoints. Covered by `mcp-panel.spec.ts`.

### 12. Settings panel missing entirely
**Status**: Fixed. `SettingsPanel.tsx` added — writable logging toggles (level, slow request threshold, request/tool/LLM/metrics logging), plus read-only sections for model config, rate limits, and exec guardrails. Save button patches `PATCH /api/settings`, reset button calls `DELETE /api/settings/overrides`. Accessible via "Settings" nav button in sidebar. Covered by `settings-panel.spec.ts`.

### 13. `/agent` slash command not registered
**Status**: Fixed. `/agent [name]` registered in `api/commands/builtin.py`. `/agent list` shows available agents; `/agent <name>` redirects the current message through the named agent. Unknown names return an error. `chat.py` extracts `explicit_agent` from redirect results and passes it to `route_message()`.

### 14. Skill builder has no UI
**Status**: Fixed. `api/routers/skills.py` adds `GET/POST/DELETE /api/skills` endpoints. Workspace skills written to `workspace/skills.yaml` and merged over built-ins at load time. `SkillsPanel` component added to sidebar — view built-in and custom skills, create new skills via form, delete custom ones.

---

## P3 — Test Gaps

### 15. No E2E test for LLM-driven tool call flow
**Status**: Covered in full-coverage.spec.ts §7 (live, skips without API key).

### 16. No E2E test for memory store → recall
**Status**: Covered in full-coverage.spec.ts §9 (API + `/tool` via chat). Proactive recall test added: stores a unique fact, starts a fresh conversation, asks a related question without `/tool`, and asserts the injected memory surfaces the fact in the LLM response (live, auto-skips without `OPENAI_API_KEY`).

### 17. No E2E test for web search end-to-end
**Status**: Covered in full-coverage.spec.ts §8 (live).

### 18. No E2E test for image upload → multimodal response
**Status**: Fixed. `tests/e2e/image-upload.spec.ts` uploads a real image via the DOM file input, verifies previews/removal, and covers the live multimodal path when `OPENAI_API_KEY` is present.

### 19. No E2E test for background task lifecycle
**Status**: Covered in full-coverage.spec.ts §10 including poll-until-complete (live).

### 20. No E2E test for scheduled task create → list → **disable**
**Status**: Fixed. `tests/e2e/schedule-disable.spec.ts` covers create → disable → verify disabled → re-enable, plus the unhappy path for unknown schedules.

### 21. No E2E test for auth enforcement
**Status**: Covered in full-coverage.spec.ts §19 (skips if auth not enabled).

### 22. No E2E test for exec approval full UI path
**Status**: Fixed. `tests/e2e/exec-approve-ui.spec.ts` exercises the full `/exec git status` approval flow in the UI, including Allow and Deny.

### 23. No Docker-stack E2E config
**Status**: Fixed — `tests/playwright.docker.config.ts` + `npm run test:docker` added in `706c8ab`.

### 24. Bootstrap → reload → no duplicates regression
**Status**: Covered in full-coverage.spec.ts (live, skips if already bootstrapped).

---

## P4 — Code Quality / Architecture

### 28. Two model capability functions duplicating `gpt-5-nano` knowledge
**Status**: Fixed. `_MODEL_CAPS_BLACKLIST` dict in `api/llm/responses.py` centralises per-capability model restrictions. `_supports_temperature` and `_supports_web_search_preview` both check against it. Adding a new restricted model requires one dict entry.

### 29. `auto_title()` LLM call has no timeout
**Status**: Fixed. `_llm_title()` now wraps the `asyncio.to_thread` call with `asyncio.wait_for(timeout=10.0)`. Slow/unavailable API calls are cancelled after 10 seconds; the title falls back to "New Chat" silently.

### 30. `OllamaProvider.stream_chat` did not emit `[DONE]` on error path
If the Ollama HTTP call failed before the `for` loop, the SSE parser would hang waiting for `[DONE]`.  
**Status**: Fixed in `706c8ab`.

### 31. `asyncio.wait` called with a list, not a set
`asyncio.wait([task], ...)` constructs a new list per iteration; `asyncio.wait` requires a set.  
**Status**: Fixed in `706c8ab`.

### 32. Inner imports inside `event_generator()` in `_finalize_bootstrap`
`from agents.prompt_builder import load_workspace_file` and `from commands.builtin import _extract_user_name` were imported inside the nested function, re-running on every bootstrap call.  
**Status**: Fixed in `706c8ab`.

### 33. Pre/post command hook rules have no UI and no test coverage
**Status**: Fixed. `HooksPanel.tsx` now has a "Rules" tab alongside "Webhooks". The tab lists all pre/post rules with type badge, trigger pattern, handler, and enable/disable/delete controls. A form allows adding new rules (name, type, trigger, handler). Backed by existing `GET/POST/DELETE/PATCH /api/hooks/rules` endpoints. Covered by `hook-rules.spec.ts`.

---

## P5 — Mobile / Responsive

### 34. Sidebar blocks content on narrow screens ✅ Fixed
**Symptom**: On screens < 768 px the `ConversationList` sidebar (fixed `w-56`) stays visible and eats half the viewport, leaving the chat area too narrow to read. There is no overlay/drawer mode or auto-collapse on small screens.  
**Fix**: detect viewport width (or use a CSS `md:` breakpoint); on mobile collapse the sidebar by default and render it as a full-height overlay drawer with a backdrop. Auto-close after selecting a conversation.

### 35. Touch targets are too small throughout ✅ Fixed
**Symptom**: Buttons in the sidebar nav (`p-1 rounded`), per-message action icons (`w-3.5 h-3.5`), panel close buttons, and many inline actions fall well below the 44 × 44 px minimum touch target recommended by WCAG / Apple HIG. On a touchscreen these are nearly impossible to tap accurately.  
**Fix**: Audit every interactive element in `ConversationList`, `Header`, the panel headers, and the message action row. Increase minimum tap area to 44 × 44 px via padding or `min-h-[44px] min-w-[44px]` wrappers.

### 36. Slide panels overflow or are too narrow on small screens ✅ Fixed
**Symptom**: `SlidePanel` renders with fixed pixel widths (`width: 28rem`, `24rem`). On a 375 px iPhone screen this renders a panel that's 75 % of the viewport width — fine — but the inner content (form fields, tables) was designed for desktop and wraps badly. On very narrow devices the panel can overflow the right edge.  
**Fix**: Change SlidePanel width to `min(28rem, 100vw)` on mobile and constrain inner content to `w-full max-w-full`. For very small screens (< 480 px) render panels as full-screen sheets instead of side-drawers.

### 37. Virtual keyboard collapses the chat area on iOS/Android ✅ Fixed
**Symptom**: When the soft keyboard opens on mobile, the viewport shrinks. The `InputForm` (fixed at the bottom) is pushed up by the keyboard but the `MessageList` area collapses to almost nothing — messages are hidden behind the input. `messagesEndRef.scrollIntoView` stops working correctly because the layout shifts mid-animation.  
**Fix**: Use `dvh` (dynamic viewport height) for the root container instead of `h-screen`. Ensure the message container uses `flex-1 min-h-0 overflow-y-auto` and that scroll-into-view fires after the resize event settles. Test on Chrome + Safari mobile.

### 38. StatusBar token row wraps ungracefully at < 360 px ✅ Fixed
**Symptom**: The status bar shows `N total | N prompt | N completion` in a single `flex gap-4` row. Below ~360 px the three spans wrap to multiple lines, doubling the status bar height and covering message content.  
**Fix**: Wrap counts in `flex-wrap` with a smaller `gap-2` or collapse to just the total count on very small screens (`hidden sm:inline`).

### 39. No `<meta name="viewport">` audit — pinch-zoom risk ✅ Already correct
**Symptom**: Unknown whether the HTML template includes a proper viewport meta tag. Without `<meta name="viewport" content="width=device-width, initial-scale=1">`, mobile browsers render Ray at desktop scale, making everything tiny.  
**Fix**: Verify `ui/index.html` contains the correct viewport meta tag. Also consider `user-scalable=no` is **not** set — users should be able to zoom.

### 40. Code blocks and tool result cards overflow horizontally on mobile ✅ Fixed
**Symptom**: `<pre>` blocks inside assistant messages and tool result cards (JSON, command output) are wide enough to cause horizontal scroll of the entire message container, which shifts the whole chat view.  
**Fix**: Add `overflow-x-auto` to `<pre>` and result card wrappers so only the code block scrolls, not the page. Already partly done for markdown code blocks; ensure tool result cards (`ray_tool`) and citations have the same treatment.

### 41. Image attachments in the input bar stack vertically on mobile ✅ Fixed
**Symptom**: Multiple image attachment thumbnails are arranged in a horizontal row that can overflow the input width on narrow screens, causing the send button to be clipped.  
**Fix**: Constrain the attachment strip to `flex-wrap` so images wrap to a second line, or cap the number of visible thumbnails at 2 with an overflow count badge.

---

## P0 — Current Docker-Stack Regressions

### 42. Bootstrap chat/UI flows are still regressing against the live stack
**Symptom**: The Docker-stack Playwright run still fails on bootstrap-related flows that should be stable. Observed failures include `/bootstrap status` via chat in `full-coverage.spec.ts`, `/bootstrap done` without markers in `bootstrap-context.spec.ts`, and the UI chat-bubble variant of `/bootstrap done`.  
**Root cause (unconfirmed)**: The API-only bootstrap checks pass, but several chat/UI paths fail or time out, which suggests the regression is in streamed command-result handling or bootstrap state transitions rather than the raw bootstrap endpoints themselves.  
**Status**: Open. Reproduced on 2026-04-13 with `npx playwright test --config=playwright.docker.config.ts`.

### 43. Exec approval Allow path is unreliable in the UI
**Symptom**: `tests/e2e/exec-approve-ui.spec.ts` still fails on the happy path (`/exec git status` → Allow → output in chat) and on the approval-card content assertion, while the Deny path passes.  
**Root cause (unconfirmed)**: This does not look like a blanket exec failure. The problem appears to be specific to the approval UI state or the post-approval result rendering path.  
**Status**: Open. Reproduced on 2026-04-13 against the Docker stack.

---

## P3 — Test / Contract Drift

### 44. Memory search contract is inconsistent across the API, panel, and E2E coverage
**Symptom**: Memory search coverage is unreliable. `MemoryPanel.tsx` submits `POST /api/memory/search`, but `tests/e2e/full-coverage.spec.ts` still calls `GET /api/memory/search?q=...`, which the router does not expose. The memory panel search test also fails in the live Docker run.  
**Root cause (partially confirmed)**: There is at least one confirmed contract mismatch: `api/routers/memory.py` only defines `POST /memory/search`, while part of the E2E suite still expects a GET route. There may also be a separate UI issue in the panel flow.  
**Status**: Open. Reproduced on 2026-04-13.

### 45. `full-coverage.spec.ts` has broad chat/slash-command drift against the current UI
**Symptom**: A large block of `full-coverage.spec.ts` fails under the live Docker stack across chat rendering, send-button recovery, `/new`, `/clear`, `/status`, `/tool`, `/skill`, `/schedule`, `/file`, `/task`, and related command flows, while smaller smoke/API specs for several of the same features still pass.  
**Root cause (unconfirmed)**: The failure pattern suggests suite drift rather than one backend outage. The likely causes are stale helper assumptions, stale DOM selectors, or outdated expectations for how command results now render in chat.  
**Status**: Open. Reproduced on 2026-04-13 with the Docker-stack Playwright run.

### 46. Tool and memory E2E expectations are stale in places
**Symptom**: The Docker-stack run still reports failures for `get_current_time` result expectations and several memory-related command assertions inside `full-coverage.spec.ts`, despite the direct backend pytest suite passing and the simpler tool API checks still succeeding.  
**Root cause (unconfirmed)**: The API/tool surfaces appear healthier than the end-to-end expectations. This points to stale test assertions about response shape or rendered text rather than a single systemic tool failure.  
**Status**: Open. Reproduced on 2026-04-13.

---

## Prioritised Fix Order

| # | Issue | Effort | Impact | Status |
|---|-------|--------|--------|--------|
| 42 | Bootstrap chat/UI regressions on live stack | Medium | Blocking | Open |
| 43 | Exec approval Allow path unreliable | Medium | High | Open |
| 45 | Full-coverage Playwright suite drift | Medium | High | Open |
| 44 | Memory search contract drift | Small | Medium | Open |
| 46 | Tool/memory E2E expectations stale | Small | Medium | Open |
| 1 | LLM tool call errors | — | Blocking | ✅ Fixed cc5e145 |
| 2 | Duplicate bootstrap messages | — | Blocking | ✅ Fixed 305ccd3 |
| 3 | Bootstrap SSE gateway timeout | — | Blocking | ✅ Fixed 0d95b1a |
| 30 | Ollama missing [DONE] | Tiny | Low | ✅ Fixed 706c8ab |
| 31 | asyncio.wait set | Tiny | Low | ✅ Fixed 706c8ab |
| 32 | Inner imports in bootstrap | Tiny | Low | ✅ Fixed 706c8ab |
| 4 | Memory proactive injection | Medium | **High** | ✅ Fixed |
| 5 | Memory panel UI | Medium | **High** | ✅ Fixed |
| 8 | Model switcher UI | Small | **High** | ✅ Fixed |
| 6 | Web search citations (function tool) | Small | Medium | ✅ Fixed |
| 22 | E2E: exec Approve button UI | Small | Medium | ✅ Fixed |
| 20 | E2E: schedule disable + PATCH endpoint | Small | Medium | ✅ Fixed |
| 18 | E2E: image upload → multimodal response | Medium | Medium | ✅ Fixed |
| 7 | PDF RAG pipeline | Large | Medium | ✅ Fixed |
| 9 | Workspace file editors UI | Small | Low | ✅ Fixed |
| 10 | API key management UI | Small | Low | Open |
| 11 | MCP server form | Medium | Low | ✅ Fixed |
| 12 | Settings panel | Large | Low | ✅ Fixed |
| 13 | `/agent` slash command | Small | Low | ✅ Fixed |
| 14 | Skill builder UI | Medium | Low | ✅ Fixed |
| 16 | E2E: proactive memory recall | Small | Low | ✅ Fixed |
| 29 | auto_title timeout/fallback | Tiny | Low | ✅ Fixed |
| 28 | Central model capabilities registry | Small | Low | ✅ Fixed |
| 33 | Pre/post hook UI + tests | Large | Low | ✅ Fixed |
