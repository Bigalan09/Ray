"""Built-in tool: web_fetch -- fetch a URL and return readable content."""
from __future__ import annotations

import re

import httpx


_MAX_BYTES = 512_000  # 512 KB max response body
_TIMEOUT = 30


def _html_to_text(html: str) -> str:
    """Best-effort HTML to readable text conversion without external deps."""
    # Remove script/style blocks
    text = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", "", html, flags=re.S | re.I)
    # Convert common block elements to newlines
    text = re.sub(r"<(br|hr|/p|/div|/tr|/li|/h[1-6])[^>]*>", "\n", text, flags=re.I)
    # Convert list items to bullet points
    text = re.sub(r"<li[^>]*>", "\n- ", text, flags=re.I)
    # Strip remaining tags
    text = re.sub(r"<[^>]+>", "", text)
    # Decode common HTML entities
    for entity, char in [("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                          ("&quot;", '"'), ("&#39;", "'"), ("&nbsp;", " ")]:
        text = text.replace(entity, char)
    # Collapse whitespace
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


async def web_fetch(url: str, raw: bool = False) -> dict:
    """Fetch content from a URL and return it as readable text.

    Parameters
    ----------
    url : str
        The URL to fetch.
    raw : bool
        If True, return the raw response body without HTML-to-text conversion.
    """
    if not url or not url.strip():
        return {"error": "URL is required."}

    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    headers = {
        "User-Agent": "Ray/1.0 (AI Assistant; +https://github.com/Bigalan09/Ray)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=_TIMEOUT) as client:
            resp = await client.get(url, headers=headers)
            resp.raise_for_status()

            content_type = resp.headers.get("content-type", "")
            body = resp.text[:_MAX_BYTES]

            if raw or "text/plain" in content_type or "application/json" in content_type:
                return {
                    "url": str(resp.url),
                    "status": resp.status_code,
                    "content_type": content_type.split(";")[0].strip(),
                    "content": body,
                    "bytes": len(body),
                }

            # HTML → readable text
            text = _html_to_text(body)
            return {
                "url": str(resp.url),
                "status": resp.status_code,
                "content_type": content_type.split(";")[0].strip(),
                "content": text[:_MAX_BYTES],
                "bytes": len(text),
            }

    except httpx.HTTPStatusError as exc:
        return {"error": f"HTTP {exc.response.status_code}: {exc.response.reason_phrase}", "url": url}
    except httpx.TimeoutException:
        return {"error": f"Request timed out after {_TIMEOUT}s", "url": url}
    except Exception as exc:
        return {"error": f"Failed to fetch URL: {exc}", "url": url}
