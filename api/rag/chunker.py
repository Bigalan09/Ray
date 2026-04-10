from __future__ import annotations


def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Split text into overlapping chunks for embedding."""
    if not text.strip():
        return []

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size

        # Try to break at a paragraph or sentence boundary
        if end < len(text):
            # Look for paragraph break
            para_break = text.rfind("\n\n", start + chunk_size // 2, end + 100)
            if para_break > start:
                end = para_break + 2
            else:
                # Look for sentence break
                for sep in [". ", ".\n", "? ", "! "]:
                    sent_break = text.rfind(sep, start + chunk_size // 2, end + 50)
                    if sent_break > start:
                        end = sent_break + len(sep)
                        break

        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)

        start = end - overlap
        if start >= len(text):
            break

    return chunks
