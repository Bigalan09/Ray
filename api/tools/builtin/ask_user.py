"""Built-in tool: ask_user -- present a question with optional choices to the user.

When the agent needs clarification before proceeding, it calls this tool.
The tool returns a structured question that the UI renders as an interactive
choice card. The agent loop pauses until the user responds.
"""
from __future__ import annotations


async def ask_user(
    question: str,
    options: list[str] | None = None,
    allow_free_text: bool = True,
) -> dict:
    """Present a question to the user, optionally with suggested choices.

    Parameters
    ----------
    question : str
        The question to ask the user.
    options : list[str] | None
        Optional list of suggested choices (e.g. ["Option A", "Option B"]).
        The user can still type a free-text answer if allow_free_text is True.
    allow_free_text : bool
        Whether the user can type a custom answer instead of choosing an option
        (default: True).
    """
    if not question or not question.strip():
        return {"error": "Question is required."}

    return {
        "status": "question",
        "question": question.strip(),
        "options": options or [],
        "allow_free_text": allow_free_text,
        "message": question.strip(),
    }
