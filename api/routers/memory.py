from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from memory.store import memory_search, memory_store, memory_list, memory_delete

router = APIRouter()


class MemorySearchRequest(BaseModel):
    query: str
    limit: int = 5


class MemoryStoreRequest(BaseModel):
    content: str
    tags: list[str] = []
    source: str | None = None


@router.post("/memory/search")
async def search(req: MemorySearchRequest):
    return await memory_search(req.query, req.limit)


@router.post("/memory/store")
async def store(req: MemoryStoreRequest):
    return await memory_store(req.content, req.tags, req.source)


@router.get("/memory")
async def list_memories(limit: int = 20):
    return await memory_list(limit)


@router.delete("/memory/{memory_id}")
async def delete(memory_id: str):
    return await memory_delete(memory_id)
