from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from config import load_yaml
from tools.registry import execute_tool

router = APIRouter()


class ToolExecuteRequest(BaseModel):
    tool_name: str
    arguments: dict = {}


@router.get("/tools")
async def list_tools():
    """Return all tool definitions from the YAML config."""
    config = load_yaml("tools.yaml")
    return config.get("tools", [])


@router.post("/tools/execute")
async def execute(req: ToolExecuteRequest):
    """Execute a tool directly (for testing)."""
    result = await execute_tool(req.tool_name, req.arguments)
    return result
