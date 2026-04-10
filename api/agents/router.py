from __future__ import annotations

import json
import re

from agents.registry import get_agent, get_agent_names, load_agents


# Keyword patterns for intent-based routing
_PATTERNS: list[tuple[str, list[str]]] = [
    ("researcher", [
        r"\bsearch\b", r"\bfind out\b", r"\blook up\b", r"\bresearch\b",
        r"\bwhat is\b", r"\bwho is\b", r"\bnews\b", r"\blatest\b",
        r"\bcurrent\b.*\b(price|rate|status|weather)\b",
    ]),
    ("writer", [
        r"\bwrite\b", r"\bdraft\b", r"\bcompose\b", r"\barticle\b",
        r"\bemail\b", r"\bblog\b", r"\bessay\b", r"\bletter\b",
        r"\bsummar(y|ise|ize)\b", r"\brewrite\b", r"\bedit\b.*\b(text|doc|content)\b",
    ]),
    ("coder", [
        r"\bcode\b", r"\bfunction\b", r"\bbug\b", r"\bimplement\b",
        r"\bdebug\b", r"\brefactor\b", r"\bpython\b", r"\btypescript\b",
        r"\bjavascript\b", r"\bapi\b", r"\btest\b.*\b(code|function|class)\b",
        r"\bfix\b.*\b(error|bug|issue)\b",
    ]),
]


def route_message(
    message: str,
    current_agent: str = "general",
    explicit_agent: str | None = None,
) -> str:
    """Determine which agent should handle the message.

    Priority:
    1. Explicit agent selection (from UI or /agent command)
    2. /agent command in message text
    3. Keyword-based intent matching
    4. LLM-based classification (if keywords are ambiguous)
    5. Stay with current agent
    """
    # Explicit selection from UI
    if explicit_agent:
        agent = get_agent(explicit_agent)
        if agent:
            return explicit_agent

    # Check for /agent command in message
    agent_cmd = re.match(r"^/agent\s+(\w+)", message.strip(), re.I)
    if agent_cmd:
        requested = agent_cmd.group(1).lower()
        if requested in get_agent_names():
            return requested

    lower = message.lower()

    # Score each agent by pattern matches
    scores: dict[str, int] = {}
    for agent_name, patterns in _PATTERNS:
        score = sum(1 for p in patterns if re.search(p, lower))
        if score > 0:
            scores[agent_name] = score

    if scores:
        best = max(scores, key=lambda k: scores[k])
        return best

    # LLM-based fallback for ambiguous messages
    llm_result = _llm_route(message)
    if llm_result and llm_result in get_agent_names():
        return llm_result

    # Default: stay with current agent
    return current_agent


def _llm_route(message: str) -> str | None:
    """Use a lightweight LLM call to classify the message intent.

    Returns an agent name or None if classification fails.
    """
    try:
        from config import settings, load_yaml, get_default_model
        if not settings.openai_api_key:
            return None

        from llm.responses import _get_client, response_output_text
        client = _get_client()
        models_config = load_yaml("models.yaml")
        model = get_default_model(models_config)

        agents = load_agents()
        agent_descriptions = "\n".join(
            f"- {a['name']}: {a.get('description', '')}" for a in agents
        )

        response = client.responses.create(
            model=model,
            instructions=(
                "You are a message classifier. Given a user message, respond with ONLY "
                "the name of the most appropriate agent. No explanation.\n\n"
                f"Available agents:\n{agent_descriptions}\n\n"
                "If none is clearly appropriate, respond with: general"
            ),
            input=[
                {
                    "role": "user",
                    "content": message,
                },
            ],
            temperature=0,
        )

        result = response_output_text(response).strip().lower()
        if result in get_agent_names():
            return result
        return None

    except Exception:
        return None
