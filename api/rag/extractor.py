from __future__ import annotations

from pathlib import Path


async def extract_text(file_path: str, content_type: str = "") -> str:
    """Extract text from a file based on its type."""
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf" or "pdf" in content_type:
        return _extract_pdf(path)
    elif suffix in (".docx",) or "document" in content_type or "word" in content_type:
        return _extract_docx(path)
    elif suffix in (".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".py", ".js", ".ts"):
        return path.read_text(encoding="utf-8", errors="replace")
    else:
        # Try reading as text
        try:
            return path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return ""


def _extract_pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(str(path))
        text_parts = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
        return "\n\n".join(text_parts)
    except Exception as e:
        return f"[Error extracting PDF: {e}]"


def _extract_docx(path: Path) -> str:
    try:
        from docx import Document
        doc = Document(str(path))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        return f"[Error extracting DOCX: {e}]"
