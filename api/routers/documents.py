from __future__ import annotations

import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel

from rag.extractor import extract_text
from rag.store import ingest_document, rag_search, list_documents, delete_document

router = APIRouter()


class SearchRequest(BaseModel):
    query: str
    limit: int = 5


@router.post("/documents/upload")
async def upload_document(file: UploadFile = File(...)):
    """Upload and ingest a document for RAG retrieval."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Save to temp file
    suffix = Path(file.filename).suffix
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Extract text
        text = await extract_text(tmp_path, file.content_type or "")
        if not text.strip():
            raise HTTPException(status_code=400, detail="No text could be extracted from the file")

        # Ingest into ChromaDB
        result = await ingest_document(
            text=text,
            source=file.filename,
            metadata={"content_type": file.content_type, "size": len(content)},
        )
        return result
    finally:
        os.unlink(tmp_path)


@router.post("/documents/search")
async def search_documents(req: SearchRequest):
    """Search ingested documents."""
    return await rag_search(req.query, req.limit)


@router.get("/documents")
async def list_docs():
    """List all ingested documents."""
    return await list_documents()


@router.delete("/documents/{document_id}")
async def delete_doc(document_id: str):
    """Delete an ingested document."""
    return await delete_document(document_id)
