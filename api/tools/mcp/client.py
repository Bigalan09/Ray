from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any


class MCPStdioClient:
    """Client for communicating with an MCP server over stdio (JSON-RPC)."""

    def __init__(self, command: str, args: list[str], env: dict[str, str] | None = None):
        self.command = command
        self.args = args
        self.env = env
        self._process: asyncio.subprocess.Process | None = None
        self._buffer = ""

    async def start(self) -> None:
        """Start the MCP server subprocess with isolated environment."""
        import os
        # Minimal environment: only PATH and explicitly configured vars.
        # MCP servers do NOT inherit the full parent environment.
        minimal_env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": os.environ.get("HOME", os.environ.get("USERPROFILE", "")),
            "TEMP": os.environ.get("TEMP", "/tmp"),
            "TMP": os.environ.get("TMP", "/tmp"),
        }
        if self.env:
            minimal_env.update(self.env)

        self._process = await asyncio.create_subprocess_exec(
            self.command, *self.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=minimal_env,
        )

    async def stop(self) -> None:
        """Stop the MCP server subprocess."""
        if self._process:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self._process.kill()
            self._process = None

    @property
    def is_running(self) -> bool:
        return self._process is not None and self._process.returncode is None

    async def _send_request(self, method: str, params: dict | None = None) -> dict:
        """Send a JSON-RPC request and wait for the response."""
        if not self._process or not self._process.stdin or not self._process.stdout:
            raise RuntimeError("MCP server not running")

        request_id = str(uuid.uuid4())
        request = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
        }
        if params:
            request["params"] = params

        msg = json.dumps(request) + "\n"
        self._process.stdin.write(msg.encode())
        await self._process.stdin.drain()

        # Read response line
        response_line = await asyncio.wait_for(
            self._process.stdout.readline(),
            timeout=30,
        )
        response = json.loads(response_line.decode())

        if "error" in response:
            raise RuntimeError(f"MCP error: {response['error']}")

        return response.get("result", {})

    async def initialize(self) -> dict:
        """Send the initialize request to the MCP server."""
        return await self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "Ray", "version": "0.1.0"},
        })

    async def list_tools(self) -> list[dict]:
        """Discover available tools from the MCP server."""
        result = await self._send_request("tools/list")
        return result.get("tools", [])

    async def call_tool(self, name: str, arguments: dict) -> Any:
        """Call a tool on the MCP server."""
        result = await self._send_request("tools/call", {
            "name": name,
            "arguments": arguments,
        })
        # MCP returns content as a list of content blocks
        content = result.get("content", [])
        if content and isinstance(content, list):
            texts = [c.get("text", "") for c in content if c.get("type") == "text"]
            return {"result": "\n".join(texts)}
        return {"result": str(result)}
