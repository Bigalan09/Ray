from __future__ import annotations

import asyncio
import json
import re
import time as _time

import httpx
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from config import settings, load_yaml, get_default_model
from memory.conversation import add_message, auto_title, conversation_exists
from agents.router import route_message
from agents.base import build_agent_context
from agents.prompt_builder import load_workspace_file
from commands.builtin import _extract_user_name
import structlog
from llm.providers import resolve_model_provider, RetryableStreamError
from observability.llm_logger import log_llm_request, log_llm_response, log_llm_retry, log_tool_call
from observability.context import get_request_id
from observability.metrics import (
    chat_requests_total,
    chat_tool_rounds_total,
    chat_response_duration,
    chat_internal_errors_total,
    chat_tool_exceptions_total,
)
from tools.result_utils import normalise_tool_result

log = structlog.get_logger("ray.chat")
router = APIRouter()

_KEEPALIVE = {"data": json.dumps({"ray_metadata": {"type": "keepalive"}})}
_llm_semaphore = asyncio.Semaphore(10)  # max 10 concurrent LLM inference calls

MAX_RETRIES = settings.max_retries
BASE_DELAY_MS = settings.base_delay_ms


def _parse_wait_time(error_text: str, retry_after: str | None = None) -> float:
    if retry_after:
        try:
            return float(retry_after)
        except ValueError:
            pass
    m = re.search(r"retry after (\d+(?:\.\d+)?)\s*(second|minute|ms)", error_text, re.I)
    if m:
        value = float(m.group(1))
        unit = m.group(2).lower()
        if unit.startswith("minute"):
            return value * 60
        if unit.startswith("ms"):
            return value / 1000
        return value
    return 0


def _is_retryable(status: int) -> bool:
    return status == 429 or 500 <= status < 600


def _try_save_bootstrap(text: str) -> bool:
    """If the response contains bootstrap file markers, parse and save them."""
    if "IDENTITY_START" not in text:
        return False
    try:
        from bootstrap import mark_bootstrapped

        def _extract(start_marker: str, end_marker: str) -> str:
            pattern = f"{start_marker}[\\s\\n]*(.*?)[\\s\\n]*{end_marker}"
            m = re.search(pattern, text, re.DOTALL)
            return m.group(1).strip() if m else ""

        identity = _extract("---IDENTITY_START---", "---IDENTITY_END---")
        soul = _extract("---SOUL_START---", "---SOUL_END---")
        user = _extract("---USER_START---", "---USER_END---")

        if identity:
            mark_bootstrapped(identity, soul, user)
            log.info("Bootstrap complete: identity files saved to workspace/")
            return True
        else:
            log.warning("Bootstrap markers found but IDENTITY section was empty")
    except Exception:
        log.warning("Failed to parse bootstrap response", exc_info=True)
    return False


async def _finalize_bootstrap(
    messages: list[dict],
    deployment: str,
    models_config: dict,
    conversation_id: str | None,
):
    """Buffer LLM response silently, save bootstrap files, return clean message.

    Sends periodic keepalive pings while the LLM is generating so that
    reverse-proxies (Traefik, nginx) do not drop the SSE connection during
    the potentially long identity-file generation.
    """

    async def event_generator():
        try:
            # Run the LLM call concurrently so we can ping the client every few
            # seconds — reverse proxies (Traefik) drop idle SSE connections.
            task = asyncio.create_task(
                _generate_bootstrap_content(messages, deployment, models_config)
            )
            while True:
                done, _ = await asyncio.wait({task}, timeout=4)
                if done:
                    break
                yield _KEEPALIVE

            accumulated = await task
            saved = _try_save_bootstrap(accumulated)

            if saved:
                user_content = load_workspace_file("USER.md")
                name = _extract_user_name(user_content)
                greeting = f"Hi {name}, how can I help?" if name else "Hi, how can I help?"
                clean_msg = f"Updated IDENTITY.md, SOUL.md, USER.md.\n\n{greeting}"
            else:
                clean_msg = "Could not save identity files. Try `/bootstrap done` again."

            yield {"data": json.dumps({"type": "command_result", "content": clean_msg})}

            if conversation_id:
                try:
                    add_message(conversation_id, "assistant", clean_msg,
                                metadata={"command": "bootstrap"})
                    auto_title(conversation_id)
                except Exception:
                    log.warning("Failed to persist bootstrap response", exc_info=True)

        except Exception as exc:
            log.warning("Bootstrap finalization failed", exc_info=True)
            yield {"data": json.dumps({"type": "command_result", "content": f"Bootstrap failed: {exc}. Try `/bootstrap done` again."})}

        yield {"data": "[DONE]"}

    return EventSourceResponse(event_generator())


async def _generate_bootstrap_content(
    messages: list[dict],
    deployment: str,
    models_config: dict,
) -> str:
    """Get full LLM response for bootstrap file generation (buffered, not streamed)."""
    provider, resolved_model = resolve_model_provider(deployment)
    agent_name = route_message("", "general")
    agent_ctx = build_agent_context(agent_name)

    full_messages = [{"role": "system", "content": agent_ctx["system_prompt"]}, *messages]
    accumulated = ""
    async for raw_line in provider.stream_chat(
        messages=full_messages,
        temperature=agent_ctx["temperature"],
        model=resolved_model,
    ):
        if raw_line.startswith("data: "):
            data = raw_line[6:]
            if data == "[DONE]":
                break
            try:
                parsed = json.loads(data)
                choices = parsed.get("choices") or []
                content = choices[0].get("delta", {}).get("content") if choices else None
                if content:
                    accumulated += content
            except (json.JSONDecodeError, IndexError):
                pass
    return accumulated


def _public_error_message(request_id: str | None = None) -> str:
    if request_id:
        return f"Request failed. Check the logs with request ID {request_id}."
    return "Request failed. Check the application logs for details."


def _sse_error(
    message: str,
    retryable: bool = False,
    request_id: str | None = None,
    tool_name: str | None = None,
    round_number: int | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> dict:
    """Build a structured SSE error event."""
    payload = {"type": "error", "message": message, "retryable": retryable}
    if request_id:
        payload["request_id"] = request_id
    if tool_name:
        payload["tool_name"] = tool_name
    if round_number is not None:
        payload["round"] = round_number
    if provider:
        payload["provider"] = provider
    if model:
        payload["model"] = model
    return {"data": json.dumps(payload)}


def _error_stream_response(
    *,
    message: str,
    retryable: bool = False,
    request_id: str | None = None,
    tool_name: str | None = None,
    round_number: int | None = None,
    provider: str | None = None,
    model: str | None = None,
) -> EventSourceResponse:
    async def event_generator():
        yield _sse_error(
            message,
            retryable=retryable,
            request_id=request_id,
            tool_name=tool_name,
            round_number=round_number,
            provider=provider,
            model=model,
        )
        yield {"data": "[DONE]"}

    return EventSourceResponse(event_generator())


def _append_tool_call_fragment(tool_calls: list[dict], dtc: dict) -> None:
    idx = dtc.get("index", 0)
    if not isinstance(idx, int) or idx < 0:
        raise ValueError(f"Invalid tool call index: {idx!r}")

    while len(tool_calls) <= idx:
        tool_calls.append({"id": "", "type": "function", "function": {"name": "", "arguments": ""}})

    tool_id = dtc.get("id")
    if tool_id is not None:
        if not isinstance(tool_id, str):
            raise TypeError(f"Invalid tool call id type: {type(tool_id).__name__}")
        tool_calls[idx]["id"] = tool_id

    fn = dtc.get("function", {})
    if fn is None:
        fn = {}
    if not isinstance(fn, dict):
        raise TypeError(f"Invalid tool call function type: {type(fn).__name__}")

    name_fragment = fn.get("name")
    if name_fragment is not None:
        if not isinstance(name_fragment, str):
            raise TypeError(f"Invalid tool name fragment type: {type(name_fragment).__name__}")
        tool_calls[idx]["function"]["name"] += name_fragment

    arguments_fragment = fn.get("arguments")
    if arguments_fragment is not None:
        if not isinstance(arguments_fragment, str):
            raise TypeError(f"Invalid tool arguments fragment type: {type(arguments_fragment).__name__}")
        tool_calls[idx]["function"]["arguments"] += arguments_fragment


def _prepare_tool_result(tool_name: str, result: object) -> tuple[dict, str]:
    normalised = normalise_tool_result(tool_name, result)
    try:
        return normalised, json.dumps(normalised)
    except TypeError as exc:
        fallback = {
            "error": f"Tool '{tool_name}' returned a non-serialisable result.",
            "detail": str(exc),
            "result_type": type(result).__name__,
        }
        return fallback, json.dumps(fallback)


async def _execute_tool(name: str, arguments: dict) -> dict:
    from tools.registry import execute_tool
    return await execute_tool(name, arguments)


@router.post("/chat")
async def chat(request: Request):
    """SSE streaming chat endpoint."""
    try:
        payload = await request.json()
        if "messages" not in payload or not isinstance(payload.get("messages"), list):
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=422, content={"detail": "messages is required and must be a list"})
        messages = payload["messages"]
        model = payload.get("model")
        conversation_id = payload.get("conversation_id")

        from hooks.engine import hook_engine
        asyncio.create_task(hook_engine.emit("message_received", {
            "conversation_id": conversation_id, "model": model,
        }))
        asyncio.create_task(hook_engine.emit("message:received", {
            "conversation_id": conversation_id, "model": model,
        }))

        # Extract last user message text (handles multi-part content with images)
        last_user_msg = ""
        for m in reversed(messages):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str):
                    last_user_msg = content
                elif isinstance(content, list):
                    text_parts = [p.get("text", "") for p in content if p.get("type") == "text"]
                    last_user_msg = " ".join(text_parts)
                break

        # Slash command detection (before LLM routing)
        from commands.registry import parse_command, execute_command
        skip_bootstrap_injection = False
        cmd = parse_command(last_user_msg)
        explicit_agent: str | None = None
        if cmd:
            cmd_name, cmd_args = cmd
            ctx = {"conversation_id": conversation_id, "model": model}
            result = await execute_command(cmd_name, cmd_args, ctx)

            # Redirect: send a different message through the LLM (used by skills and /bootstrap done)
            if result.get("type") == "redirect":
                redirect_msg = result["message"]
                explicit_agent = result.get("agent")
                messages = [m for m in messages[:-1] if m.get("role") == "user" or m.get("role") == "assistant"]
                messages.append({"role": "user", "content": redirect_msg})
                last_user_msg = redirect_msg
                skip_bootstrap_injection = True

                if result.get("bootstrap_finalize"):
                    models_config_bf = load_yaml("models.yaml")
                    default_model_bf = get_default_model(models_config_bf)
                    deployment_bf = model or default_model_bf
                    return await _finalize_bootstrap(messages, deployment_bf, models_config_bf, conversation_id)
            else:
                if conversation_id:
                    try:
                        add_message(conversation_id, "assistant", result.get("content", ""),
                                    metadata={"command": result.get("command")})
                    except Exception:
                        pass

                async def cmd_generator():
                    yield {"data": json.dumps(result)}
                    yield {"data": "[DONE]"}
                return EventSourceResponse(cmd_generator())

        from bootstrap import is_bootstrapped
        if not is_bootstrapped() and not skip_bootstrap_injection:
            from agents.prompt_builder import build_system_prompt
            bootstrap_prompt = build_system_prompt("", bootstrap_mode=True)
            messages = [
                {"role": "user", "content": bootstrap_prompt},
                {"role": "assistant", "content": "Understood. I am in bootstrap mode and will stay on the onboarding conversation until /bootstrap done is called. I will not answer unrelated questions or perform other tasks."},
            ] + messages
            if messages and messages[-1].get("role") == "user":
                original = messages[-1]["content"]
                messages[-1] = {
                    "role": "user",
                    "content": (
                        "[BOOTSTRAP MODE ACTIVE] You must continue the onboarding conversation. "
                        "Do not answer unrelated questions. If the user goes off topic, "
                        "acknowledge briefly and steer back to onboarding.\n\n"
                        f"{original}"
                    ),
                }

        models_config = load_yaml("models.yaml")
        default_model = get_default_model(models_config)
        deployment = model or default_model

        from memory.store import memory_search as _mem_search
        from rag.store import rag_search as _rag_search
        injected_memories: list[dict] = []
        injected_documents: list[dict] = []
        if last_user_msg:
            try:
                mem_result = await _mem_search(last_user_msg, limit=4)
                injected_memories = mem_result.get("results", [])
            except Exception:
                pass
            try:
                doc_result = await _rag_search(last_user_msg, limit=5)
                injected_documents = doc_result.get("results", [])
            except Exception:
                pass
        agent_name = route_message(last_user_msg, "general", explicit_agent=explicit_agent)
        agent_ctx = build_agent_context(
            agent_name,
            injected_memories=injected_memories,
            injected_documents=injected_documents,
        )
        temperature = payload.get("temperature")
        effective_temp = temperature if temperature is not None else agent_ctx["temperature"]

        asyncio.create_task(hook_engine.emit("message:preprocessed", {
            "conversation_id": conversation_id, "agent": agent_name,
            "model": deployment, "memory_count": len(injected_memories),
            "document_count": len(injected_documents),
        }))

        return await _chat_direct(
            deployment, agent_name, agent_ctx, effective_temp,
            messages, conversation_id, request,
            origin_command=cmd_name if cmd else None,
        )
    except Exception:
        request_id = get_request_id() or None
        log.error(
            "Failed to initialise chat stream",
            request_id=request_id,
            exc_info=True,
        )
        try:
            chat_internal_errors_total.labels(
                agent="unknown",
                provider="unknown",
                stage="initialisation",
            ).inc()
        except Exception:
            pass
        return _error_stream_response(
            message=_public_error_message(request_id),
            request_id=request_id,
        )


async def _chat_direct(
    model: str, agent_name: str, agent_ctx: dict, temperature: float,
    messages: list[dict], conversation_id: str | None, request: Request,
    origin_command: str | None = None,
):
    """Handle chat via direct streaming."""
    from hooks.engine import hook_engine

    provider, resolved_model = resolve_model_provider(model)
    provider_name = type(provider).__name__
    enabled_tools = agent_ctx["tools"]

    if messages and messages[0].get("role") == "system":
        messages = [{"role": "system", "content": agent_ctx["system_prompt"]}, *messages[1:]]
    else:
        messages = [{"role": "system", "content": agent_ctx["system_prompt"]}, *messages]

    try:
        chat_requests_total.labels(
            agent=agent_name, has_tools=str(bool(enabled_tools))
        ).inc()
    except Exception:
        pass

    MAX_TOOL_ROUNDS = 10
    stream_failed = False

    async def _do_stream():
        """Inner generator with agent loop. Raises RetryableStreamError on 429/5xx.

        Loops: model inference -> tool execution -> model inference -> ...
        until the model produces a final text response or the round limit is hit.
        """
        nonlocal stream_failed
        accumulated_response = ""
        conversation = list(messages)
        request_id = get_request_id() or None

        for _round in range(MAX_TOOL_ROUNDS):
            if _round > 0:
                if await request.is_disconnected():
                    log.info("Client disconnected mid-tool-chain, aborting", round=_round)
                    return
                yield _KEEPALIVE

            tool_calls: list[dict] = []
            finish_reason = ""
            round_usage: dict = {}

            round_start = log_llm_request(
                model=resolved_model,
                provider=provider_name,
                agent=agent_name,
                message_count=len(conversation),
                tool_count=len(enabled_tools) if enabled_tools else 0,
                temperature=temperature,
                system_prompt=conversation[0].get("content") if conversation and conversation[0].get("role") == "system" else None,
                messages=conversation,
            )

            async with _llm_semaphore:
              async for raw_line in provider.stream_chat(
                messages=conversation,
                temperature=temperature,
                tools=enabled_tools if enabled_tools else None,
                model=resolved_model,
              ):
                if not raw_line.startswith("data: "):
                    continue

                data = raw_line[6:]
                if data == "[DONE]":
                    break

                try:
                    parsed = json.loads(data)
                    choices = parsed.get("choices") or []
                    choice = choices[0] if choices else {}
                    delta = choice.get("delta", {})

                    delta_tool_calls = delta.get("tool_calls")
                    if delta_tool_calls:
                        for dtc in delta_tool_calls:
                            _append_tool_call_fragment(tool_calls, dtc)

                    content = delta.get("content")
                    if content:
                        accumulated_response += content

                    fr = choice.get("finish_reason")
                    if fr:
                        finish_reason = fr

                    # Capture token usage from the completion event
                    if parsed.get("usage"):
                        round_usage = parsed["usage"]

                    # Provider error events use {"error": ...} but the UI
                    # expects {"type": "error", ...}. Yield the normalised
                    # form and skip the raw event.
                    if parsed.get("error") and "type" not in parsed:
                        yield _sse_error(
                            parsed.get("message", parsed["error"]),
                            request_id=request_id,
                            round_number=_round + 1,
                            provider=provider_name,
                            model=resolved_model,
                        )
                        continue
                except (json.JSONDecodeError, TypeError, ValueError) as exc:
                    stream_failed = True
                    log.warning(
                        "Malformed tool-call fragment in chat stream",
                        error=str(exc),
                        round=_round + 1,
                        provider=provider_name,
                        model=resolved_model,
                        request_id=request_id,
                        exc_info=True,
                    )
                    try:
                        chat_internal_errors_total.labels(
                            agent=agent_name,
                            provider=provider_name,
                            stage="tool_call_fragment",
                        ).inc()
                    except Exception:
                        pass
                    yield _sse_error(
                        _public_error_message(request_id),
                        request_id=request_id,
                        round_number=_round + 1,
                        provider=provider_name,
                        model=resolved_model,
                    )
                    yield {"data": "[DONE]"}
                    return
                except Exception:
                    pass

                yield {"data": data}

            # Drop any placeholder slots that never received a name (can happen when
            # text output items precede function calls in the Responses API output,
            # causing the index-based while-loop to pre-allocate empty entries).
            tool_calls = [tc for tc in tool_calls if tc["function"].get("name")]

            log_llm_response(
                model=resolved_model,
                provider=provider_name,
                agent=agent_name,
                finish_reason=finish_reason or "stop",
                prompt_tokens=round_usage.get("prompt_tokens", 0),
                completion_tokens=round_usage.get("completion_tokens", 0),
                total_tokens=round_usage.get("total_tokens", 0),
                tool_call_count=len(tool_calls),
                round_number=_round + 1,
                start_time=round_start,
                response_text=accumulated_response if finish_reason != "tool_calls" else None,
            )

            # No tool calls: the model produced a final response
            if finish_reason != "tool_calls" or not tool_calls:
                break

            try:
                chat_tool_rounds_total.labels(agent=agent_name).inc()
            except Exception:
                pass

            # Execute all tool calls in this round
            tool_messages = []
            for tc in tool_calls:
                tc_name = tc["function"]["name"]
                if not tc_name or not tc.get("id"):
                    stream_failed = True
                    invalid_name = tc_name or "unknown_tool"
                    invalid_result = {
                        "error": "Malformed tool call from model.",
                        "missing_name": not bool(tc_name),
                        "missing_call_id": not bool(tc.get("id")),
                    }
                    yield {"data": json.dumps({"ray_tool": {
                        "name": invalid_name,
                        "status": "error",
                        "result": invalid_result,
                    }})}
                    try:
                        chat_internal_errors_total.labels(
                            agent=agent_name,
                            provider=provider_name,
                            stage="tool_call_validation",
                        ).inc()
                    except Exception:
                        pass
                    yield _sse_error(
                        _public_error_message(request_id),
                        request_id=request_id,
                        tool_name=invalid_name,
                        round_number=_round + 1,
                        provider=provider_name,
                        model=resolved_model,
                    )
                    yield {"data": "[DONE]"}
                    return
                try:
                    args = json.loads(tc["function"]["arguments"])
                except (TypeError, json.JSONDecodeError):
                    stream_failed = True
                    yield {"data": json.dumps({"ray_tool": {
                        "name": tc_name,
                        "status": "error",
                        "result": {"error": "Malformed tool arguments from model."},
                    }})}
                    try:
                        chat_internal_errors_total.labels(
                            agent=agent_name,
                            provider=provider_name,
                            stage="tool_arguments",
                        ).inc()
                    except Exception:
                        pass
                    yield _sse_error(
                        _public_error_message(request_id),
                        request_id=request_id,
                        tool_name=tc_name,
                        round_number=_round + 1,
                        provider=provider_name,
                        model=resolved_model,
                    )
                    yield {"data": "[DONE]"}
                    return
                yield {"data": json.dumps({"ray_tool": {"name": tc_name, "status": "running", "arguments": args}})}
                tc_start = _time.perf_counter()
                try:
                    result = await _execute_tool(tc_name, args)
                    result, result_str = _prepare_tool_result(tc_name, result)
                except Exception as exc:
                    stream_failed = True
                    tc_duration_ms = (_time.perf_counter() - tc_start) * 1000
                    log.error(
                        "Unexpected tool-call failure in chat stream",
                        tool_name=tc_name,
                        args=args,
                        result_type=type(locals().get("result")).__name__ if "result" in locals() else None,
                        round=_round + 1,
                        provider=provider_name,
                        model=resolved_model,
                        conversation_id=conversation_id,
                        request_id=request_id,
                        exc_info=True,
                    )
                    try:
                        chat_tool_exceptions_total.labels(agent=agent_name, tool=tc_name).inc()
                        chat_internal_errors_total.labels(
                            agent=agent_name,
                            provider=provider_name,
                            stage="tool_execution",
                        ).inc()
                    except Exception:
                        pass
                    yield {"data": json.dumps({"ray_tool": {
                        "name": tc_name,
                        "status": "error",
                        "result": {"error": "Tool execution failed unexpectedly."},
                    }})}
                    yield _sse_error(
                        _public_error_message(request_id),
                        request_id=request_id,
                        tool_name=tc_name,
                        round_number=_round + 1,
                        provider=provider_name,
                        model=resolved_model,
                    )
                    yield {"data": "[DONE]"}
                    return
                tc_duration_ms = (_time.perf_counter() - tc_start) * 1000

                # exec_command: wait for user approval, then use the real result
                if result.get("status") == "approval_required":
                    pending_id = result.get("pending_id")
                    yield {"data": json.dumps({"ray_tool": {
                        "name": tc_name,
                        "status": "success",
                        "result": result,
                    }})}
                    # Emit a dedicated event so the UI shows the approval card
                    yield {"data": json.dumps({
                        "type": "exec_confirm",
                        "pending_id": pending_id,
                        "full_command": result.get("command", ""),
                        "description": result.get("description", ""),
                    })}
                    # Wait for user to approve or deny (blocks SSE stream)
                    from commands.exec_pending import get_pending
                    pending = get_pending(pending_id) if pending_id else None
                    if pending:
                        await pending.resolved.wait()
                        if pending.approved and pending.exec_result:
                            result, result_str = _prepare_tool_result(tc_name, pending.exec_result)
                            yield {"data": json.dumps({"ray_tool": {
                                "name": tc_name,
                                "status": "success",
                                "result": {"stdout": result.get("stdout", "")[:500], "exit_code": result.get("exit_code")},
                            }})}
                            tool_messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result_str})
                        else:
                            tool_messages.append({"role": "tool", "tool_call_id": tc["id"], "content": '{"denied": true, "message": "User denied this command."}'})
                        from commands.exec_pending import remove_pending
                        remove_pending(pending_id)
                    else:
                        tool_messages.append({"role": "tool", "tool_call_id": tc["id"], "content": '{"error": "Pending execution not found."}'})
                    continue

                has_error = "error" in result
                log_tool_call(
                    tool=tc_name,
                    args=args,
                    result=result,
                    error=result.get("error") if has_error else None,
                    duration_ms=tc_duration_ms,
                )
                # Truncate large results for the SSE event (full result still goes to the model)
                if len(result_str) > 2000:
                    result_preview = {"result": result_str[:2000] + "... (truncated)"}
                else:
                    result_preview = result
                yield {"data": json.dumps({"ray_tool": {
                    "name": tc_name,
                    "status": "error" if has_error else "success",
                    "result": result_preview,
                }})}
                # Emit ray_citations for web_search function tool results so the
                # UI renders citation cards the same way it does for web_search_preview.
                if tc_name == "web_search" and not has_error:
                    cites = [
                        {"url": r["url"], "title": r.get("title", r["url"])}
                        for r in result.get("results", [])
                        if r.get("url")
                    ]
                    if cites:
                        yield {"data": json.dumps({"ray_citations": cites})}
                tool_messages.append({"role": "tool", "tool_call_id": tc["id"], "content": result_str})
                asyncio.create_task(hook_engine.emit("tool_executed", {
                    "tool_name": tc_name, "error": has_error,
                }))

            # Append assistant + tool messages and loop for next inference
            conversation.append({"role": "assistant", "tool_calls": tool_calls})
            conversation.extend(tool_messages)

        yield {"data": "[DONE]"}

        if conversation_id and accumulated_response and conversation_exists(conversation_id):
            try:
                add_message(conversation_id, "assistant", accumulated_response,
                            metadata={"agent": agent_name, "model": resolved_model})
                auto_title(conversation_id)
                asyncio.create_task(hook_engine.emit("response_persisted", {
                    "conversation_id": conversation_id, "agent": agent_name,
                    "model": resolved_model, "response_length": len(accumulated_response),
                }))
                asyncio.create_task(hook_engine.emit("message:sent", {
                    "conversation_id": conversation_id, "agent": agent_name,
                    "model": resolved_model, "response_length": len(accumulated_response),
                }))
                if origin_command == "compact":
                    asyncio.create_task(hook_engine.emit("session:compact:after", {
                        "conversation_id": conversation_id,
                        "summary_length": len(accumulated_response),
                    }))
            except Exception:
                log.warning("Failed to persist direct response", exc_info=True)

    async def event_generator():
        t_start = _time.perf_counter()
        last_error = None
        for attempt in range(MAX_RETRIES + 1):
            if attempt > 0:
                wait = (BASE_DELAY_MS / 1000) * (2 ** (attempt - 1))
                if isinstance(last_error, RetryableStreamError) and last_error.retry_after:
                    parsed_wait = _parse_wait_time("", last_error.retry_after)
                    if parsed_wait > 0:
                        wait = parsed_wait
                log_llm_retry(
                    model=resolved_model,
                    provider=provider_name,
                    attempt=attempt,
                    status=last_error.status if isinstance(last_error, RetryableStreamError) else 0,
                    wait_s=wait,
                )
                await asyncio.sleep(wait)
            try:
                async with asyncio.timeout(300):
                    async for event in _do_stream():
                        yield event
                if stream_failed:
                    duration = _time.perf_counter() - t_start
                    try:
                        chat_response_duration.labels(agent=agent_name, outcome="error").observe(duration)
                    except Exception:
                        pass
                    return
                duration = _time.perf_counter() - t_start
                try:
                    chat_response_duration.labels(agent=agent_name, outcome="success").observe(duration)
                except Exception:
                    pass
                yield {"data": json.dumps({"ray_metadata": {"type": "timing", "duration_s": round(duration, 3)}})}
                return
            except RetryableStreamError as exc:
                last_error = exc
                if attempt == MAX_RETRIES:
                    duration = _time.perf_counter() - t_start
                    try:
                        chat_response_duration.labels(agent=agent_name, outcome="error").observe(duration)
                    except Exception:
                        pass
                    yield _sse_error(f"Failed after {MAX_RETRIES + 1} attempts: {exc}", retryable=True)
                    yield {"data": "[DONE]"}
                    return
            except Exception as exc:
                # Unexpected error: log via structlog so it appears in Loki, then
                # surface as a graceful SSE error instead of a raw HTTP 500.
                duration = _time.perf_counter() - t_start
                request_id = get_request_id() or None
                log.error(
                    "Unhandled exception in chat stream",
                    error=str(exc),
                    error_type=type(exc).__name__,
                    agent=agent_name,
                    model=resolved_model,
                    attempt=attempt,
                    duration_s=round(duration, 3),
                    request_id=request_id,
                    exc_info=True,
                )
                try:
                    chat_internal_errors_total.labels(
                        agent=agent_name,
                        provider=provider_name,
                        stage="event_generator",
                    ).inc()
                    chat_response_duration.labels(agent=agent_name, outcome="error").observe(duration)
                except Exception:
                    pass
                yield _sse_error(
                    _public_error_message(request_id),
                    retryable=False,
                    request_id=request_id,
                    provider=provider_name,
                    model=resolved_model,
                )
                yield {"data": "[DONE]"}
                return

        duration = _time.perf_counter() - t_start
        try:
            chat_response_duration.labels(agent=agent_name, outcome="error").observe(duration)
        except Exception:
            pass
        yield _sse_error(f"Failed: {last_error}", retryable=True)
        yield {"data": "[DONE]"}

    return EventSourceResponse(event_generator())
