"""Exec command guardrails: allowlist validation and environment sanitisation."""
from __future__ import annotations

import os
import re
import shlex
from dataclasses import dataclass, field

from config import load_yaml, settings

# Shell metacharacters that must never appear in a command string.
_DANGEROUS_CHARS = re.compile(r"[;|&$`(){}<>~!#\n\r]")

# Allowed environment variables for subprocess execution.
_SAFE_ENV_KEYS = {"PATH", "HOME", "USER", "LANG", "TERM", "LC_ALL"}

_cached_config: dict | None = None


@dataclass
class ValidationResult:
    """Result of validating a command against exec guardrails."""

    allowed: bool
    tokens: list[str] = field(default_factory=list)
    rule: dict | None = None
    error: str | None = None
    timeout: int = 30
    working_dir: str = ""
    max_output: int = 65536


def load_exec_config(*, force_reload: bool = False) -> dict:
    """Load the exec section from guardrails.yaml. Caches after first load."""
    global _cached_config
    if _cached_config is None or force_reload:
        guardrails = load_yaml("guardrails.yaml")
        _cached_config = guardrails.get("exec", {})
    return _cached_config


def validate_command(raw_input: str) -> ValidationResult:
    """Validate a raw command string against the exec guardrails allowlist.

    Validation steps:
    1. Check exec is enabled.
    2. Reject shell metacharacters in the raw string.
    3. Tokenise with shlex.
    4. Reject absolute paths in the executable position.
    5. Match executable against the allowlist.
    6. Match subcommand (first argument) against allowed args.
    """
    config = load_exec_config()

    if not config.get("enabled", False):
        return ValidationResult(allowed=False, error="Exec is disabled.")

    allow_list = config.get("allow", [])
    if not allow_list:
        return ValidationResult(allowed=False, error="No commands are permitted. The exec allowlist is empty.")

    raw = raw_input.strip()
    if not raw:
        return ValidationResult(allowed=False, error="No command provided.")

    # Step 1: reject shell metacharacters before any parsing.
    if _DANGEROUS_CHARS.search(raw):
        return ValidationResult(
            allowed=False,
            error="Command contains shell metacharacters which are not permitted.",
        )

    # Step 2: tokenise.
    try:
        tokens = shlex.split(raw)
    except ValueError as exc:
        return ValidationResult(allowed=False, error=f"Invalid command syntax: {exc}")

    if not tokens:
        return ValidationResult(allowed=False, error="No command provided.")

    executable = tokens[0]

    # Step 3: reject absolute or relative paths in the executable position.
    if "/" in executable or "\\" in executable:
        return ValidationResult(
            allowed=False,
            tokens=tokens,
            error="Absolute or relative paths are not permitted. Use the bare command name.",
        )

    default_timeout = config.get("default_timeout", 30)
    working_dir = config.get("working_directory", str(settings.workspace_dir))
    max_output = config.get("max_output_bytes", 65536)

    def _allowed(rule: dict) -> ValidationResult:
        return ValidationResult(
            allowed=True,
            tokens=tokens,
            rule=rule,
            timeout=rule.get("timeout", default_timeout),
            working_dir=working_dir,
            max_output=max_output,
        )

    # Step 4: match against allowlist.
    for rule in allow_list:
        if rule.get("command") != executable:
            continue

        # Executable matches. Now check the subcommand / first argument.
        allowed_args = rule.get("args", "*")

        if allowed_args == "*":
            return _allowed(rule)

        if isinstance(allowed_args, list):
            if len(tokens) < 2:
                allowed_str = ", ".join(allowed_args)
                return ValidationResult(
                    allowed=False,
                    tokens=tokens,
                    error=f"`{executable}` requires a subcommand. Allowed: {allowed_str}",
                )

            subcommand = tokens[1]
            if subcommand in allowed_args:
                return _allowed(rule)

            allowed_str = ", ".join(allowed_args)
            return ValidationResult(
                allowed=False,
                tokens=tokens,
                error=f"`{executable} {subcommand}` is not allowed. Permitted subcommands: {allowed_str}",
            )

    # No matching rule found.
    allowed_commands = [r.get("command", "?") for r in allow_list]
    return ValidationResult(
        allowed=False,
        tokens=tokens,
        error=f"`{executable}` is not in the allowed commands list: {', '.join(allowed_commands)}",
    )


def get_allowed_commands() -> list[dict]:
    """Return a summary of all allowed commands for display."""
    config = load_exec_config()
    allow_list = config.get("allow", [])
    result = []
    for rule in allow_list:
        cmd = rule.get("command", "?")
        args = rule.get("args", "*")
        desc = rule.get("description", "")
        if args == "*":
            summary = cmd
        elif isinstance(args, list):
            summary = ", ".join(f"{cmd} {a}" for a in args)
        else:
            summary = cmd
        result.append({"command": cmd, "args": args, "description": desc, "summary": summary})
    return result


def validate_and_create_pending(raw_command: str) -> tuple[ValidationResult, "PendingExec | None"]:
    """Validate a command and create a pending execution if allowed.

    Returns (validation_result, pending_or_none). Callers only need to
    check validation_result.allowed and format their response around
    the pending object.
    """
    from commands.exec_pending import create_pending

    result = validate_command(raw_command)
    if not result.allowed:
        return result, None

    pending = create_pending(
        tokens=result.tokens,
        rule=result.rule,
        timeout=result.timeout,
        working_dir=result.working_dir,
        max_output=result.max_output,
    )
    return result, pending


def sanitize_env() -> dict[str, str]:
    """Return a minimal environment dict safe for subprocess execution."""
    return {k: v for k, v in os.environ.items() if k in _SAFE_ENV_KEYS}
