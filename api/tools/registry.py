from __future__ import annotations

from tools.builtin.web_search import web_search
from tools.builtin.calculator import calculator
from tools.builtin.current_time import get_current_time
from memory.store import memory_search, memory_store
from tools.builtin.update_profile import update_user_profile
from tools.builtin.workspace_files import write_file, read_file, list_files
from rag.store import rag_search
from tools.builtin.exec_tool import exec_command
from tools.builtin.spawn_tasks import spawn_tasks, spawn_agent
from tools.builtin.schedule_tools import list_schedules, create_schedule, remove_schedule
from tools.builtin.web_fetch import web_fetch
from tools.builtin.grep_files import grep_files
from tools.builtin.glob_files import glob_files
from tools.builtin.ask_user import ask_user
from tools.result_utils import normalise_tool_result

TOOL_HANDLERS: dict[str, callable] = {
    "web_search": web_search,
    "calculator": calculator,
    "get_current_time": get_current_time,
    "memory_search": memory_search,
    "memory_store": memory_store,
    "update_user_profile": update_user_profile,
    "document_search": rag_search,
    "write_file": write_file,
    "read_file": read_file,
    "list_files": list_files,
    "exec_command": exec_command,
    "spawn_tasks": spawn_tasks,
    "spawn_agent": spawn_agent,
    "list_schedules": list_schedules,
    "create_schedule": create_schedule,
    "remove_schedule": remove_schedule,
    "web_fetch": web_fetch,
    "grep_files": grep_files,
    "glob_files": glob_files,
    "ask_user": ask_user,
}


async def execute_tool(name: str, arguments: dict) -> dict:
    """Execute a registered tool by name. Checks built-in tools first, then MCP tools."""
    # Check built-in tools
    handler = TOOL_HANDLERS.get(name)
    if handler is not None:
        try:
            return normalise_tool_result(name, await handler(**arguments))
        except Exception as e:
            return {"error": str(e)}

    # Check MCP tools
    if name.startswith("mcp__"):
        from tools.mcp.manager import execute_mcp_tool
        try:
            return normalise_tool_result(name, await execute_mcp_tool(name, arguments))
        except Exception as e:
            return {"error": str(e)}

    return {"error": f"Unknown tool: {name}"}
