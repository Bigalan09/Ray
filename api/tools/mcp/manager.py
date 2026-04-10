from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path

from config import settings
from tools.mcp.client import MCPStdioClient

log = logging.getLogger(__name__)

# Active MCP server instances
_servers: dict[str, MCPStdioClient] = {}
_discovered_tools: dict[str, dict] = {}  # tool_name -> {server_name, definition}
_server_configs: dict[str, dict] = {}  # name -> original config for restart
_restart_lock = asyncio.Lock()
_MAX_RESTART_ATTEMPTS = 3


def _load_mcp_config() -> list[dict]:
    """Load MCP server configuration from workspace/mcp_servers.json."""
    config_path = settings.data_dir / "mcp_servers.json"
    if not config_path.exists():
        # Also check config dir
        config_path = settings.config_dir / "mcp_servers.json"
    if not config_path.exists():
        return []

    import json
    with open(config_path) as f:
        data = json.load(f)
    return data.get("servers", [])


def _resolve_env(env_map: dict[str, str] | None) -> dict[str, str] | None:
    """Resolve ${VAR} references in environment variables."""
    if not env_map:
        return None
    resolved = {}
    for k, v in env_map.items():
        if isinstance(v, str) and v.startswith("${") and v.endswith("}"):
            var_name = v[2:-1]
            resolved[k] = os.environ.get(var_name, "")
        else:
            resolved[k] = v
    return resolved


async def _start_server(server_def: dict) -> bool:
    """Start a single MCP server and discover its tools. Returns True on success."""
    name = server_def["name"]
    command = server_def["command"]
    args = server_def.get("args", [])
    env = _resolve_env(server_def.get("env"))

    client = MCPStdioClient(command, args, env)
    try:
        await client.start()
        await client.initialize()

        tools = await client.list_tools()
        _servers[name] = client
        _server_configs[name] = server_def

        for tool in tools:
            tool_name = f"mcp__{name}__{tool['name']}"
            _discovered_tools[tool_name] = {
                "server_name": name,
                "original_name": tool["name"],
                "definition": tool,
            }
            log.info("MCP: Registered tool %s from %s", tool_name, name)

        return True
    except Exception as e:
        log.warning("MCP: Failed to start server '%s': %s", name, e)
        await client.stop()
        return False


async def start_mcp_servers() -> None:
    """Start all enabled MCP servers and discover their tools."""
    servers_config = _load_mcp_config()

    for server_def in servers_config:
        if not server_def.get("enabled", True):
            continue
        await _start_server(server_def)


async def stop_mcp_servers() -> None:
    """Stop all running MCP servers."""
    for name, client in _servers.items():
        try:
            await client.stop()
        except Exception as e:
            log.warning("MCP: Error stopping server '%s': %s", name, e)
    _servers.clear()
    _discovered_tools.clear()
    _server_configs.clear()


async def _restart_server(name: str) -> bool:
    """Restart a crashed MCP server. Returns True on success."""
    async with _restart_lock:
        # Re-check after acquiring lock (another coroutine may have restarted it)
        client = _servers.get(name)
        if client and client.is_running:
            return True

        config = _server_configs.get(name)
        if not config:
            # Try reloading from disk in case config was added after startup
            for server_def in _load_mcp_config():
                if server_def["name"] == name:
                    config = server_def
                    break
            if not config:
                log.warning("MCP: No config found for server '%s', cannot restart", name)
                return False

        # Clean up old client
        old_client = _servers.pop(name, None)
        if old_client:
            try:
                await old_client.stop()
            except Exception:
                pass

        # Remove stale tool entries for this server
        stale_keys = [k for k, v in _discovered_tools.items() if v["server_name"] == name]
        for k in stale_keys:
            del _discovered_tools[k]

        for attempt in range(1, _MAX_RESTART_ATTEMPTS + 1):
            log.info("MCP: Restarting server '%s' (attempt %d/%d)", name, attempt, _MAX_RESTART_ATTEMPTS)
            if await _start_server(config):
                log.info("MCP: Server '%s' restarted successfully", name)
                return True
            if attempt < _MAX_RESTART_ATTEMPTS:
                await asyncio.sleep(1 * attempt)

        log.error("MCP: Failed to restart server '%s' after %d attempts", name, _MAX_RESTART_ATTEMPTS)
        return False


def get_mcp_tools() -> list[dict]:
    """Get OpenAI-format tool definitions for all discovered MCP tools."""
    tools = []
    for tool_name, info in _discovered_tools.items():
        defn = info["definition"]
        tools.append({
            "type": "function",
            "function": {
                "name": tool_name,
                "description": defn.get("description", ""),
                "parameters": defn.get("inputSchema", {"type": "object", "properties": {}}),
            },
        })
    return tools


def get_mcp_tool_names() -> list[str]:
    """Get all discovered MCP tool names."""
    return list(_discovered_tools.keys())


async def execute_mcp_tool(tool_name: str, arguments: dict) -> dict:
    """Execute an MCP tool by its registered name.

    If the owning server has crashed, attempts an automatic restart before
    returning an error.
    """
    info = _discovered_tools.get(tool_name)
    if not info:
        return {"error": f"Unknown MCP tool: {tool_name}"}

    server_name = info["server_name"]
    original_name = info["original_name"]
    client = _servers.get(server_name)

    # Auto-restart if server has crashed
    if not client or not client.is_running:
        log.warning("MCP: Server '%s' is not running, attempting restart", server_name)
        if not await _restart_server(server_name):
            return {"error": f"MCP server '{server_name}' is not running and restart failed"}
        client = _servers.get(server_name)
        if not client or not client.is_running:
            return {"error": f"MCP server '{server_name}' failed to restart"}

    try:
        return await client.call_tool(original_name, arguments)
    except Exception as e:
        # If the call itself fails, the server may have died mid-request.
        # Try one restart and retry.
        log.warning("MCP: Tool call '%s' failed (%s), attempting restart", tool_name, e)
        if await _restart_server(server_name):
            client = _servers.get(server_name)
            if client and client.is_running:
                try:
                    return await client.call_tool(original_name, arguments)
                except Exception as retry_err:
                    return {"error": f"Tool call failed after restart: {retry_err}"}
        return {"error": str(e)}


def get_server_status() -> list[dict]:
    """Get status of all configured MCP servers."""
    servers_config = _load_mcp_config()
    status = []
    for server_def in servers_config:
        name = server_def["name"]
        client = _servers.get(name)
        tool_count = sum(1 for t in _discovered_tools.values() if t["server_name"] == name)
        status.append({
            "name": name,
            "enabled": server_def.get("enabled", True),
            "running": client.is_running if client else False,
            "tool_count": tool_count,
            "command": server_def["command"],
        })
    return status
