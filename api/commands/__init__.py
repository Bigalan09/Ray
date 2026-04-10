from __future__ import annotations

from importlib import import_module

_REGISTERED = False
_COMMAND_MODULES = (
    "commands.builtin",
    "commands.file_ops",
    "commands.skills",
    "commands.exec_cmd",
    "commands.hooks_cmd",
)


def register_all_commands() -> None:
    """Import all slash command modules exactly once."""
    global _REGISTERED
    if _REGISTERED:
        return

    for module_name in _COMMAND_MODULES:
        import_module(module_name)

    _REGISTERED = True
