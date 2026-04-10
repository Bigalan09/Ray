from rag.chunker import chunk_text


def test_chunk_text_basic():
    text = "Hello world. " * 100
    chunks = chunk_text(text, chunk_size=200, overlap=50)
    assert len(chunks) > 1
    assert all(len(c) <= 300 for c in chunks)  # Allow some flexibility for boundary seeking


def test_chunk_text_empty():
    assert chunk_text("") == []
    assert chunk_text("   ") == []


def test_chunk_text_short():
    chunks = chunk_text("Short text.", chunk_size=1000)
    assert len(chunks) == 1
    assert chunks[0] == "Short text."


def test_documents_endpoint_exists(client):
    resp = client.get("/api/documents")
    assert resp.status_code == 200
