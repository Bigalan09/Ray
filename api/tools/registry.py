from __future__ import annotations

from tools.builtin.web_search import web_search
from tools.builtin.calculator import calculator
from tools.builtin.current_time import get_current_time
from memory.store import memory_search, memory_store
from tools.builtin.update_profile import update_user_profile
from tools.builtin.workspace_files import write_file, read_file, list_files
from rag.store import rag_search
from tools.builtin.exec_tool import exec_command
from tools.builtin.spawn_tasks import spawn_tasks

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
}


async def execute_tool(name: str, arguments: dict) -> dict:
    """Execute a registered tool by name. Checks built-in tools first, then MCP tools."""
    # Check built-in tools
    handler = TOOL_HANDLERS.get(name)
    if handler is not None:
        try:
            return await handler(**arguments)
        except Exception as e:
            return {"error": str(e)}

    # Check MCP tools
    if name.startswith("mcp__"):
        from tools.mcp.manager import execute_mcp_tool
        return await execute_mcp_tool(name, arguments)

    return {"error": f"Unknown tool: {name}"}
