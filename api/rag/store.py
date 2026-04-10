from __future__ import annotations

import uuid
from datetime import datetime, timezone

from rag.chunker import chunk_text

try:
    import chromadb
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False

_client = None
_collection = None

CHROMA_HOST = "ray-chromadb"
CHROMA_PORT = 8000
COLLECTION_NAME = "ray_documents"


def _get_collection():
    global _client, _collection
    if _collection is not None:
        return _collection
    if not HAS_CHROMADB:
        return None
    try:
        _client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
        _collection = _client.get_or_create_collection(
            name=COLLECTION_NAME,
            metadata={"hnsw:space": "cosine"},
        )
        return _collection
    except Exception:
        return None


async def ingest_document(
    text: str,
    source: str,
    metadata: dict | None = None,
    chunk_size: int = 1000,
    overlap: int = 200,
) -> dict:
    """Chunk and store a document in ChromaDB for RAG retrieval."""
    collection = _get_collection()
    if collection is None:
        return {"ingested": False, "note": "Document store not available"}

    chunks = chunk_text(text, chunk_size, overlap)
    if not chunks:
        return {"ingested": False, "error": "No text extracted"}

    doc_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    ids = []
    documents = []
    metadatas = []
    for i, chunk in enumerate(chunks):
        chunk_id = f"{doc_id}_chunk_{i}"
        ids.append(chunk_id)
        documents.append(chunk)
        meta = {
            "document_id": doc_id,
            "source": source,
            "chunk_index": i,
            "total_chunks": len(chunks),
            "ingested_at": now,
        }
        if metadata:
            meta.update(metadata)
        metadatas.append(meta)

    try:
        collection.add(ids=ids, documents=documents, metadatas=metadatas)
        return {
            "ingested": True,
            "document_id": doc_id,
            "chunks": len(chunks),
            "source": source,
        }
    except Exception as e:
        return {"ingested": False, "error": str(e)}


async def rag_search(query: str, limit: int = 5) -> dict:
    """Search documents for relevant chunks."""
    collection = _get_collection()
    if collection is None:
        return {"results": [], "note": "Document store not available"}

    try:
        results = collection.query(query_texts=[query], n_results=limit)
        documents = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"][0]):
                meta = results["metadatas"][0][i] if results["metadatas"] else {}
                documents.append({
                    "content": doc,
                    "source": meta.get("source", "unknown"),
                    "chunk_index": meta.get("chunk_index"),
                    "distance": results["distances"][0][i] if results["distances"] else None,
                })
        return {"results": documents, "query": query}
    except Exception as e:
        return {"results": [], "error": str(e)}


async def list_documents() -> dict:
    """List all ingested documents (unique by document_id)."""
    collection = _get_collection()
    if collection is None:
        return {"documents": [], "note": "Document store not available"}

    try:
        results = collection.get(include=["metadatas"])
        seen = {}
        if results and results["metadatas"]:
            for meta in results["metadatas"]:
                doc_id = meta.get("document_id", "")
                if doc_id and doc_id not in seen:
                    seen[doc_id] = {
                        "document_id": doc_id,
                        "source": meta.get("source", "unknown"),
                        "total_chunks": meta.get("total_chunks", 0),
                        "ingested_at": meta.get("ingested_at", ""),
                    }
        return {"documents": list(seen.values())}
    except Exception as e:
        return {"documents": [], "error": str(e)}


async def delete_document(document_id: str) -> dict:
    """Delete all chunks of a document."""
    collection = _get_collection()
    if collection is None:
        return {"deleted": False, "note": "Document store not available"}

    try:
        collection.delete(where={"document_id": document_id})
        return {"deleted": True}
    except Exception as e:
        return {"deleted": False, "error": str(e)}
