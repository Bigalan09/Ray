# TOOLS.md

## Built-in Tools

### Information
- **calculator** - Evaluate maths expressions. Params: `expression`.
- **get_current_time** - Current date/time. Optional: `timezone` (e.g. Europe/London).
- **web_search** - Search the web. Params: `query`, optional `max_results`.

### Memory
- **memory_search** - Search stored memory. Params: `query`, optional `limit`.
- **memory_store** - Save a fact to memory. Params: `content`, optional `tags`.
- **update_user_profile** - Add lasting observation to USER.md. Params: `observation`, optional `section`.
- **document_search** - Search uploaded documents. Params: `query`, optional `limit`.

### Workspace Files
- **write_file** - Write/create a file. Params: `filename`, `content`. Scoped to /workspace.
- **read_file** - Read a file. Params: `filename`.
- **list_files** - List directory contents. Optional: `directory`.

### Scheduling
- **list_schedules** - Show all scheduled tasks and next run times.
- **create_schedule** - Create a cron-scheduled task. Params: `name`, `cron`, `prompt`, optional `agent`.
- **remove_schedule** - Remove a schedule by name. Params: `name`.

### Execution
- **exec_command** - Run an allowlisted system command. Requires user approval. Params: `command`.
- **spawn_tasks** - Run multiple agent tasks in parallel. Params: `tasks` (array of {prompt, agent}).

## MCP Tools

MCP tools are provided by external servers configured in `workspace/mcp_servers.json`. They appear as `mcp__<server>__<tool>` in the function list. Call them the same way as built-in tools.

Common MCP servers:
- **filesystem** - Read, write, list, search files. Tools: `read_file`, `write_file`, `edit_file`, `list_directory`, `search_files`, etc.
- **claude-code** - Run Claude Code as a sub-agent for coding tasks. Tool: `claude_code`.

## Notes

_Add environment-specific notes, workarounds, or preferences below._

---

