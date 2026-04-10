from __future__ import annotations

import httpx


async def web_search(query: str, max_results: int = 5) -> dict:
    """Search the web using DuckDuckGo HTML endpoint."""
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers={"User-Agent": "Ray/0.1"},
                timeout=10,
            )
            resp.raise_for_status()

            # Simple extraction from DDG HTML results
            import re
            results = []
            # Find result snippets
            for match in re.finditer(
                r'class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>.*?'
                r'class="result__snippet"[^>]*>(.*?)</span>',
                resp.text,
                re.DOTALL,
            ):
                if len(results) >= max_results:
                    break
                url = match.group(1)
                title = re.sub(r"<[^>]+>", "", match.group(2)).strip()
                snippet = re.sub(r"<[^>]+>", "", match.group(3)).strip()
                results.append({"title": title, "url": url, "snippet": snippet})

            return {"results": results, "query": query}

    except Exception as e:
        return {"error": str(e), "query": query}
