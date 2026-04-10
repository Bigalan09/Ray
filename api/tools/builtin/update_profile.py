from __future__ import annotations

from pathlib import Path
from config import settings


async def update_user_profile(observation: str, section: str = "Notes") -> dict:
    """Append an observation about the user to USER.md.

    Agents call this when they learn something durable about the user's
    preferences, workflow, or context.
    """
    me_path = settings.workspace_dir / "USER.md"
    if not me_path.exists():
        return {"updated": False, "error": "USER.md not found"}

    try:
        content = me_path.read_text(encoding="utf-8")

        # Find the section to append to, or add to Notes
        section_header = f"## {section}"
        if section_header in content:
            # Append after the section header
            idx = content.index(section_header)
            # Find the next line after the header
            next_newline = content.index("\n", idx)
            insert_point = next_newline + 1
            # Find the next section header or end of file
            next_section = content.find("\n## ", insert_point)
            if next_section == -1:
                insert_point = len(content)
            else:
                insert_point = next_section

            updated = content[:insert_point].rstrip() + f"\n- {observation}\n" + content[insert_point:]
        else:
            # Append a new section at the end
            updated = content.rstrip() + f"\n\n## {section}\n\n- {observation}\n"

        me_path.write_text(updated, encoding="utf-8")
        return {"updated": True, "section": section, "observation": observation}

    except Exception as e:
        return {"updated": False, "error": str(e)}
