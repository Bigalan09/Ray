# AGENTS.md

Operating manual for AI coding agents working on the Ray codebase. Read this before making any changes.

## Development Workflow

Every change follows this sequence. No exceptions.

1. **Understand** -- Read the relevant code. Form a hypothesis. Do not guess.
2. **Test first (red)** -- Write or identify a failing test that represents the desired behaviour.
3. **Implement (green)** -- Write the minimum code to make the test pass.
4. **Verify** -- Run the full test suite. Fix regressions before moving on.
5. **Update docs** -- README.md, CHANGELOG.md, and CLAUDE.md must reflect the change.
6. **Commit** -- One logical commit with a clear message. Co-author line required.
7. **Deploy** -- `docker compose up --build -d` and confirm the stack is healthy.
8. **Smoke test** -- Run `npx playwright test` against the running stack.

If any step fails, fix it before proceeding to the next. Do not skip steps.

## Testing

### Red/Green Cycle

Write the test before the implementation, or immediately after the first working version. The test must fail without your change and pass with it.

For backend changes, prefer Playwright e2e tests that hit the running API. For isolated logic (validation, parsing), Python unit tests in `api/tests/` are acceptable.

### Test Structure

Tests live in `tests/e2e/` as Playwright specs. Each feature gets its own file.

```
tests/
  e2e/
    smoke.spec.ts          -- UI smoke tests, API endpoint checks
    exec.spec.ts           -- /exec command and tool tests
    hooks.spec.ts          -- Hooks system tests
    bootstrap-context.spec.ts
    bootstrap-interactive.spec.ts
    tool-notifications.spec.ts
  playwright.config.ts     -- UI tests (port 3000, reuseExistingServer)
  playwright.api.config.ts -- API-only tests (port 8000, no UI needed)
```

### Running Tests

```bash
# Against running Docker stack (preferred)
cd tests && npx playwright test --config=playwright.config.ts

# Single spec file
npx playwright test e2e/hooks.spec.ts --config=playwright.config.ts

# API-only (no UI)
npx playwright test --config=playwright.api.config.ts

# Python unit tests
cd api && python -m pytest tests/ -v
```

### Happy and Unhappy Paths

Every feature needs both:

- **Happy path**: The expected flow works (command succeeds, card renders, webhook fires).
- **Unhappy path**: Bad input is rejected, missing resources return errors, injection attempts are blocked, expired state is handled.

Example from exec tests: `/exec whoami` (happy), `/exec curl evil` (rejected), `/exec git status; rm -rf /` (injection blocked), approve with expired ID (expired).

### No Regressions

Run the full suite before committing. If existing tests break, your change has a regression. Fix it or revert. Do not disable or weaken existing tests.

## UI/UX Standards

### Branding

- **Product name**: Ray
- **Colour palette**: Dark theme defined in `ui/src/index.css` as CSS custom properties.
  - Backgrounds: `--bg-base` (#1e1e1e), `--bg-deeper` (#1a1d23), `--bg-surface` (#22262b), `--bg-raised` (#23272e)
  - Text: `--text-primary` (#d4d4d4), `--text-heading` (#e0e0e0), `--text-muted` (#999)
  - Accent: `--accent` (#3b82f6, blue-500)
  - Border: `--border` (#333)
- **Gradients**: Assistant message bubbles use `bg-gradient-to-br from-[var(--bg-surface)] to-[#1d2127]`.
- **Fonts**: System UI stack. Monospace for code, commands, and tool names.

### Component Patterns

- **Message bubbles**: `p-4 rounded-lg shadow-lg` with gradient backgrounds. User messages right-aligned, assistant left-aligned.
- **Sidebar panels**: Fixed right-side overlay, `w-96` or `w-[28rem]`, `bg-[var(--bg-deeper)]`, border-left. Header with title, action buttons, close button. Scrollable content area.
- **Modals**: `fixed inset-0 bg-black/60 z-[60]` backdrop. Centred content card with `bg-[var(--bg-raised)]`, border, rounded-xl.
- **Buttons**: Primary: `bg-blue-600 hover:bg-blue-500 text-white rounded-lg`. Danger: `bg-red-600/40 hover:bg-red-500/60`. Ghost: `bg-[var(--bg-deeper)] border border-[var(--border)]`.
- **Tool chips**: Collapsible "Used N tools" accordion above assistant messages. Individual tools show status icon, name, expandable args/result.
- **Input area**: Full-width bar at bottom with textarea, file upload button, send/stop button. Replaced by approval bar when exec is pending.
- **Toasts**: Bottom-right, auto-dismiss after 5s. Three types: success (green), error (red), info (blue).

### Interaction Patterns

- **Exec approval**: Input area is replaced with "Allow Ray to run command?" bar showing the command and Allow/Deny buttons. This matches the Claude Code pattern. The normal input returns after the user decides.
- **Slash commands**: Detected before LLM routing. Results rendered as assistant messages. Autocomplete dropdown triggers on `/`.
- **Streaming**: SSE from `/api/chat`. Tool events shown as chips during streaming. Text accumulates in a live response bubble.

### Consistency Rules

- Use CSS custom properties from `index.css` for all colours. Do not hardcode new hex values.
- Follow existing component patterns. If adding a new panel, copy the SchedulePanel or MCPPanel structure.
- Tailwind classes for layout. CSS variables for theme colours.
- No emojis unless the user explicitly requests them.

## Documentation

### What Must Be Updated

Every change that adds or modifies user-visible behaviour must update:

1. **CLAUDE.md** -- The primary reference for AI agents. Add or update the relevant section.
2. **README.md** -- User-facing documentation. Update command tables, architecture diagrams, and feature sections.
3. **CHANGELOG.md** -- Add entry under `[Unreleased]` with the date. Use Added/Changed/Fixed/Removed categories.

### CHANGELOG Format

```markdown
## [Unreleased] - YYYY-MM-DD

### Added
- **Feature name**: One-line description of what was added and why it matters.

### Changed
- **What changed**: Brief description.

### Fixed
- **What was fixed**: Brief description.
```

### Commit Messages

Format: imperative subject line, blank line, body explaining what and why.

```
Add hooks system: webhooks, lifecycle events, pre/post hooks, UI panel

Adds a general-purpose hook system with three capabilities:
[body explaining the change]

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

Always include the co-author line. Use `cat <<'EOF'` heredoc for multi-line messages.

## Architecture Quick Reference

```
api/routers/        HTTP endpoints
api/commands/       Slash command handlers
api/agents/         Agent routing and context
api/llm/            LLM provider abstraction
api/tools/          Built-in tools + MCP
api/hooks/          Hook engine, handlers, models
api/memory/         SQLite conversations + ChromaDB
api/tasks/          Background tasks + scheduler
api/security/       Auth, rate limiting, audit
ui/src/components/  React components
config/             YAML configuration (read-only in Docker)
workspace/          Ray's runtime state (gitignored)
tests/e2e/          Playwright test specs
```

### Adding a Feature (Checklist)

- [ ] Read existing code in the relevant area
- [ ] Write e2e test (red)
- [ ] Implement the feature (green)
- [ ] Run full test suite (no regressions)
- [ ] Update CLAUDE.md
- [ ] Update README.md (if user-visible)
- [ ] Update CHANGELOG.md
- [ ] Commit with descriptive message
- [ ] `docker compose up --build -d`
- [ ] Run `npx playwright test` against stack
