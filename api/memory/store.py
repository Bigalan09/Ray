from __future__ import annotations

import uuid
from datetime import datetime, timezone

try:
    import chromadb
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False


_client = None
_collection = None

CHROMA_HOST = "ray-chromadb"
CHROMA_PORT = 8000
COLLECTION_NAME = "ray_memories"


def _get_collection():
    """Get or create the ChromaDB collection. Falls back gracefully if unavailable."""
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
        # ChromaDB not available (e.g. running tests without Docker)
        return None


async def memory_search(query: str, limit: int = 5) -> dict:
    """Search semantic memory for relevant past context."""
    collection = _get_collection()
    if collection is None:
        return {"results": [], "note": "Memory store not available"}

    try:
        results = collection.query(query_texts=[query], n_results=limit)
        memories = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"][0]):
                meta = results["metadatas"][0][i] if results["metadatas"] else {}
                memories.append({
                    "content": doc,
                    "metadata": meta,
                    "distance": results["distances"][0][i] if results["distances"] else None,
                })
        return {"results": memories, "query": query}
    except Exception as e:
        return {"results": [], "error": str(e)}


async def memory_store(content: str, tags: list[str] | None = None, source: str | None = None) -> dict:
    """Store a memory in ChromaDB."""
    collection = _get_collection()
    if collection is None:
        return {"stored": False, "note": "Memory store not available"}

    try:
        mem_id = str(uuid.uuid4())
        metadata = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "source": source or "user",
        }
        if tags:
            metadata["tags"] = ",".join(tags)

        collection.add(
            ids=[mem_id],
            documents=[content],
            metadatas=[metadata],
        )

        # Append to daily memory log (workspace/memory/YYYY-MM-DD.md)
        try:
            from config import settings
            today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            memory_dir = settings.workspace_dir / "memory"
            memory_dir.mkdir(parents=True, exist_ok=True)
            daily_file = memory_dir / f"{today}.md"
            with open(daily_file, "a", encoding="utf-8") as f:
                tag_str = f" [{', '.join(tags)}]" if tags else ""
                f.write(f"\n- {metadata['timestamp']}{tag_str}: {content[:200]}\n")
        except Exception:
            pass

        return {"stored": True, "id": mem_id}
    except Exception as e:
        return {"stored": False, "error": str(e)}


async def memory_list(limit: int = 20) -> dict:
    """List recent memories."""
    collection = _get_collection()
    if collection is None:
        return {"memories": [], "note": "Memory store not available"}

    try:
        results = collection.get(limit=limit, include=["documents", "metadatas"])
        memories = []
        if results and results["documents"]:
            for i, doc in enumerate(results["documents"]):
                meta = results["metadatas"][i] if results["metadatas"] else {}
                memories.append({"id": results["ids"][i], "content": doc, "metadata": meta})
        return {"memories": memories}
    except Exception as e:
        return {"memories": [], "error": str(e)}


async def memory_delete(memory_id: str) -> dict:
    """Delete a specific memory."""
    collection = _get_collection()
    if collection is None:
        return {"deleted": False, "note": "Memory store not available"}

    try:
        collection.delete(ids=[memory_id])
        return {"deleted": True}
    except Exception as e:
        return {"deleted": False, "error": str(e)}
