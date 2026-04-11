from __future__ import annotations

import asyncio
import json
import os

import httpx

from config import settings, load_yaml, get_default_model
from agents.base import build_agent_context
from agents.router import route_message
from llm.providers import resolve_model_provider
from tasks.store import update_task_status, TaskStatus, get_task, create_task, set_task_conversation
from tools.registry import execute_tool
from routers.ws import broadcast_task_update
from memory.conversation import create_conversation, add_message

import logging
import time as _time
import structlog
log = structlog.get_logger("ray.tasks")
from observability.llm_logger import log_tool_call

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")


async def run_agent_task(task_id: str) -> str:
    """Execute an agent task (non-streaming) and return the result."""
    task = get_task(task_id)
    if not task:
        return ""

    update_task_status(task_id, TaskStatus.RUNNING)

    from hooks.engine import hook_engine
    asyncio.create_task(hook_engine.emit("task_started", {
        "task_id": task_id, "prompt": task["prompt"], "agent": task.get("agent", "general"),
    }))

    # Create a conversation for this task so output is visible in the sidebar
    prompt = task["prompt"]
    task_type = task.get("type", "background")
    schedule_name = (task.get("metadata") or {}).get("schedule_name", "")
    title_prefix = f"[{schedule_name}]" if schedule_name else f"[{task_type}]"
    title = f"{title_prefix} {prompt[:50]}{'...' if len(prompt) > 50 else ''}"

    try:
        conv = create_conversation(title=title, source="task")
        conversation_id = conv["id"]
        set_task_conversation(task_id, conversation_id)
        add_message(conversation_id, "user", prompt)
    except Exception:
        log.warning("Failed to create task conversation", exc_info=True)
        conversation_id = None

    await broadcast_task_update(task_id)

    try:
        agent_name = task.get("agent", "general")
        agent_ctx = build_agent_context(agent_name)
        models_config = load_yaml("models.yaml")
        default_model = get_default_model(models_config)
        provider, model_id = resolve_model_provider(default_model)

        messages = [
            {"role": "system", "content": agent_ctx["system_prompt"]},
            {"role": "user", "content": prompt},
        ]
        result_text = await _complete_non_streaming(
            provider, model_id, messages, agent_ctx["temperature"], agent_ctx["tools"]
        )

        # Save result to conversation
        if conversation_id:
            try:
                add_message(conversation_id, "assistant", result_text)
            except Exception:
                log.warning("Failed to add task result to conversation", exc_info=True)

        update_task_status(task_id, TaskStatus.COMPLETED, result=result_text)
        await broadcast_task_update(task_id)
        asyncio.create_task(hook_engine.emit("task_completed", {
            "task_id": task_id, "prompt": prompt, "result_length": len(result_text),
        }))
        return result_text

    except Exception as e:
        # Save error to conversation
        if conversation_id:
            try:
                add_message(conversation_id, "system", f"Task failed: {e}")
            except Exception:
                pass

        update_task_status(task_id, TaskStatus.FAILED, error=str(e))
        await broadcast_task_update(task_id)
        asyncio.create_task(hook_engine.emit("task_failed", {
            "task_id": task_id, "prompt": prompt, "error": str(e),
        }))
        return ""


async def _collect_round(
    provider, model_id: str, conversation: list[dict],
    temperature: float, tools: list[dict] | None,
) -> tuple[list[dict], str, str]:
    """Run one streaming inference round. Returns (tool_calls, finish_reason, text)."""
    full_text = ""
    tool_calls: list[dict] = []
    finish_reason = ""

    async for line in provider.stream_chat(
        messages=conversation,
        temperature=temperature,
        tools=tools if tools else None,
        model=model_id,
    ):
        if not line.startswith("data: "):
            continue
        data = line[6:]
        if data == "[DONE]":
            break
        try:
            parsed = json.loads(data)
            choice = (parsed.get("choices") or [{}])[0]
            delta = choice.get("delta", {})
            content = delta.get("content")
            if content:
                full_text += content
            delta_tc = delta.get("tool_calls")
            if delta_tc:
                for dtc in delta_tc:
                    idx = dtc.get("index", 0)
                    while len(tool_calls) <= idx:
                        tool_calls.append({"id": "", "type": "function",
                                           "function": {"name": "", "arguments": ""}})
                    if dtc.get("id"):
                        tool_calls[idx]["id"] = dtc["id"]
                    fn = dtc.get("function", {})
                    if fn.get("name"):
                        tool_calls[idx]["function"]["name"] += fn["name"]
                    if fn.get("arguments"):
                        tool_calls[idx]["function"]["arguments"] += fn["arguments"]
            fr = choice.get("finish_reason")
            if fr:
                finish_reason = fr
        except json.JSONDecodeError:
            pass

    tool_calls = [tc for tc in tool_calls if tc["function"].get("name")]
    return tool_calls, finish_reason, full_text


async def _complete_non_streaming(
    provider, model_id: str, messages: list[dict],
    temperature: float, tools: list[dict] | None,
) -> str:
    """Run a non-streaming LLM completion with a full multi-round tool loop."""
    MAX_ROUNDS = 10
    conversation = list(messages)
    full_text = ""

    for _round in range(MAX_ROUNDS):
        tool_calls, finish_reason, round_text = await _collect_round(
            provider, model_id, conversation, temperature, tools
        )
        full_text += round_text

        if finish_reason != "tool_calls" or not tool_calls:
            break

        tool_messages = []
        for tc in tool_calls:
            try:
                args = json.loads(tc["function"]["arguments"])
            except json.JSONDecodeError:
                args = {}
            tc_name = tc["function"]["name"]
            tc_start = _time.perf_counter()
            result = await execute_tool(tc_name, args)
            tc_duration_ms = (_time.perf_counter() - tc_start) * 1000
            log_tool_call(
                tool=tc_name,
                args=args,
                result=result,
                error=result.get("error") if "error" in result else None,
                duration_ms=tc_duration_ms,
            )
            tool_messages.append({
                "role": "tool",
                "tool_call_id": tc["id"],
                "content": json.dumps(result),
            })

        conversation.append({"role": "assistant", "tool_calls": tool_calls})
        conversation.extend(tool_messages)

    return full_text


async def run_parallel_subtasks(
    parent_task_id: str,
    subtasks: list[dict],
) -> list[dict]:
    """Run multiple sub-agent tasks in parallel. Each subtask is a dict with 'prompt' and optional 'agent'."""
    # Create subtask records
    created = []
    for st in subtasks:
        t = create_task(
            task_type="subtask",
            prompt=st["prompt"],
            agent=st.get("agent", "general"),
            parent_id=parent_task_id,
            metadata=st.get("metadata"),
        )
        created.append(t)

    # Run all in parallel
    results = await asyncio.gather(
        *[run_agent_task(t["id"]) for t in created],
        return_exceptions=True,
    )

    # Collect results
    output = []
    for t, result in zip(created, results):
        task_data = get_task(t["id"])
        if isinstance(result, Exception):
            output.append({"id": t["id"], "status": "failed", "error": str(result)})
        else:
            output.append({"id": t["id"], "status": task_data["status"], "result": result})

    return output
