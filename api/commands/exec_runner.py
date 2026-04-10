"""Sandboxed command execution for the /exec system."""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass

from commands.exec_guardrails import sanitize_env


@dataclass
class ExecResult:
    """Result of executing a command."""

    exit_code: int
    stdout: str
    stderr: str
    timed_out: bool
    truncated: bool
    duration_ms: float


async def run_command(
    tokens: list[str],
    timeout: int = 30,
    working_dir: str = "/workspace",
    max_output: int = 65536,
) -> ExecResult:
    """Execute a command in a sandboxed subprocess.

    - Uses create_subprocess_exec (shell=False).
    - Restricted environment (no secrets).
    - Enforced timeout with SIGTERM then SIGKILL.
    - Output capped at max_output bytes.
    """
    env = sanitize_env()
    start = time.monotonic()
    timed_out = False

    proc = await asyncio.create_subprocess_exec(
        *tokens,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=working_dir,
        env=env,
    )

    try:
        stdout_bytes, stderr_bytes = await asyncio.wait_for(
            proc.communicate(), timeout=timeout
        )
    except asyncio.TimeoutError:
        timed_out = True
        try:
            proc.terminate()
            # Give the process a grace period to exit cleanly.
            try:
                await asyncio.wait_for(proc.communicate(), timeout=2)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.communicate()
        except ProcessLookupError:
            pass
        stdout_bytes = b""
        stderr_bytes = f"Command timed out after {timeout}s and was terminated.".encode()

    elapsed = (time.monotonic() - start) * 1000

    # Decode and truncate output.
    truncated = False
    stdout_raw = stdout_bytes[:max_output]
    stderr_raw = stderr_bytes[:max_output]

    if len(stdout_bytes) > max_output or len(stderr_bytes) > max_output:
        truncated = True

    stdout = stdout_raw.decode("utf-8", errors="replace")
    stderr = stderr_raw.decode("utf-8", errors="replace")

    if truncated:
        stdout += "\n... (output truncated)"

    return ExecResult(
        exit_code=proc.returncode if proc.returncode is not None else -1,
        stdout=stdout,
        stderr=stderr,
        timed_out=timed_out,
        truncated=truncated,
        duration_ms=round(elapsed, 1),
    )
