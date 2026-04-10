"""Skills system: saved prompt templates invocable via /skill."""
from __future__ import annotations

from config import load_yaml
from commands.registry import register_command


def _load_skills() -> list[dict]:
    config = load_yaml("skills.yaml")
    return config.get("skills") or []


async def _skill(args_str: str, context: dict) -> dict:
    args = args_str.strip()
    skills = _load_skills()

    if not args or args.lower() == "list":
        if not skills:
            return {"content": "No skills configured. Add skills to `config/skills.yaml`."}
        lines = ["**Available skills:**", ""]
        for s in skills:
            lines.append(f"  `/{s['name']}`  {s.get('description', '')}")
        return {"content": "\n".join(lines)}

    parts = args.split(None, 1)
    skill_name = parts[0].lower()
    user_input = parts[1] if len(parts) > 1 else ""

    skill = next((s for s in skills if s["name"] == skill_name), None)
    if not skill:
        return {"content": f"Unknown skill: {skill_name}. Type /skill list to see available skills.", "error": True}

    template = skill.get("prompt", "{input}")
    rendered = template.replace("{input}", user_input)
    agent = skill.get("agent", "general")

    return {
        "type": "redirect",
        "message": rendered,
        "agent": agent,
        "content": f"Running skill **{skill_name}**...",
    }


def register_skill_commands():
    register_command("skill", _skill, "Run a saved prompt template", "/skill [name] [input]")


register_skill_commands()
