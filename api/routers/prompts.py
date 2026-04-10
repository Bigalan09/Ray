from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import load_yaml

router = APIRouter()


class PromptUpdate(BaseModel):
    title: str
    content: str
    temperature: float = 0.7


@router.get("/prompts")
async def list_prompts():
    """Return all prompts from the YAML config."""
    config = load_yaml("prompts.yaml")
    return config.get("prompts", [])


@router.get("/prompts/{title}")
async def get_prompt(title: str):
    """Return a single prompt by title."""
    config = load_yaml("prompts.yaml")
    for p in config.get("prompts", []):
        if p["title"] == title:
            return p
    raise HTTPException(status_code=404, detail="Prompt not found")
