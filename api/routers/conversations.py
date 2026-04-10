from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from memory.conversation import (
    create_conversation,
    list_conversations,
    get_conversation,
    delete_conversation,
    delete_all_conversations,
    update_conversation_title,
    add_message,
)

router = APIRouter()


class CreateConversationRequest(BaseModel):
    title: str = "New Chat"
    model: str | None = None
    prompt: str | None = None


class UpdateTitleRequest(BaseModel):
    title: str


class AddMessageRequest(BaseModel):
    role: str
    content: str | list


@router.get("/conversations")
async def list_convs(limit: int = 50, source: str | None = None):
    return list_conversations(limit, source=source)


@router.post("/conversations")
async def create_conv(req: CreateConversationRequest):
    return create_conversation(req.title, req.model, req.prompt)


@router.get("/conversations/{conv_id}")
async def get_conv(conv_id: str):
    conv = get_conversation(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.delete("/conversations")
async def delete_all_convs():
    count = delete_all_conversations()
    return {"success": True, "deleted": count}


@router.delete("/conversations/{conv_id}")
async def delete_conv(conv_id: str):
    if not delete_conversation(conv_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}


@router.patch("/conversations/{conv_id}")
async def update_conv(conv_id: str, req: UpdateTitleRequest):
    if not update_conversation_title(conv_id, req.title):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"success": True}


@router.post("/conversations/{conv_id}/messages")
async def add_msg(conv_id: str, req: AddMessageRequest):
    return add_message(conv_id, req.role, req.content)
