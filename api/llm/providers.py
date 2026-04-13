from __future__ import annotations

import json
from abc import ABC, abstractmethod
from typing import AsyncIterator

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError

from config import settings, load_yaml, get_default_model
from llm.responses import DEFAULT_OPENAI_BASE_URL, _get_async_client, build_request_kwargs


class RetryableStreamError(Exception):
    """Raised when a streaming call fails with a retryable status (429, 5xx)."""

    def __init__(self, status: int, message: str, retry_after: str | None = None):
        self.status = status
        self.message = message
        self.retry_after = retry_after
        super().__init__(f"HTTP {status}: {message}")


class LLMProvider(ABC):
    """Base class for LLM providers."""

    @abstractmethod
    async def stream_chat(
        self,
        messages: list[dict],
        temperature: float,
        tools: list[dict] | None = None,
    ) -> AsyncIterator[str]:
        """Stream chat completion as raw SSE lines (data: ...)."""
        ...

    @abstractmethod
    def build_url(self, model: str) -> str:
        ...


class OpenAIResponsesProvider(LLMProvider):
    """OpenAI Responses API provider."""

    def __init__(self, api_key: str, base_url: str = DEFAULT_OPENAI_BASE_URL):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")

    def build_url(self, model: str) -> str:
        return f"{self.base_url}/responses"

    async def stream_chat(
        self,
        messages: list[dict],
        temperature: float,
        tools: list[dict] | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        resolved_model = model or get_default_model()
        request_kwargs = build_request_kwargs(
            messages=messages,
            model=resolved_model,
            temperature=temperature,
            tools=tools,
            stream=True,
        )

        try:
            stream = await _get_async_client().responses.create(**request_kwargs)
        except APIStatusError as exc:
            retry_after = None
            response = getattr(exc, "response", None)
            if response is not None:
                retry_after = response.headers.get("retry-after")
            if exc.status_code == 429 or 500 <= exc.status_code < 600:
                raise RetryableStreamError(
                    status=exc.status_code,
                    message=str(exc),
                    retry_after=retry_after,
                )
            yield f'data: {json.dumps({"error": "API Error", "message": str(exc), "status": exc.status_code})}'
            return
        except (APIConnectionError, APITimeoutError) as exc:
            raise RetryableStreamError(status=503, message=str(exc))
        except Exception as exc:
            yield f'data: {json.dumps({"error": "API Error", "message": str(exc)})}'
            return

        try:
            async for event in stream:
                event_type = getattr(event, "type", "")

                if event_type == "response.output_text.delta":
                    chunk = {
                        "choices": [{
                            "delta": {"content": event.delta},
                            "index": 0,
                        }]
                    }
                    yield f"data: {json.dumps(chunk)}"

                elif event_type == "response.output_item.added":
                    item = getattr(event, "item", None)
                    if getattr(item, "type", None) != "function_call":
                        continue
                    tool_call = {
                        "index": getattr(event, "output_index", 0),
                        "id": getattr(item, "call_id", "") or getattr(item, "id", ""),
                        "type": "function",
                        "function": {"name": getattr(item, "name", "")},
                    }
                    chunk = {
                        "choices": [{
                            "delta": {"tool_calls": [tool_call]},
                            "index": 0,
                        }]
                    }
                    yield f"data: {json.dumps(chunk)}"

                elif event_type == "response.function_call_arguments.delta":
                    tool_call = {
                        "index": getattr(event, "output_index", 0),
                        "function": {"arguments": getattr(event, "delta", "")},
                    }
                    chunk = {
                        "choices": [{
                            "delta": {"tool_calls": [tool_call]},
                            "index": 0,
                        }]
                    }
                    yield f"data: {json.dumps(chunk)}"

                elif event_type in (
                    "response.web_search_call.in_progress",
                    "response.web_search_call.searching",
                ):
                    item = getattr(event, "item", None)
                    query = getattr(item, "query", None) or ""
                    yield f"data: {json.dumps({'ray_tool': {'name': 'web_search', 'status': 'running', 'arguments': {'query': query}}})}"

                elif event_type == "response.web_search_call.completed":
                    yield f"data: {json.dumps({'ray_tool': {'name': 'web_search', 'status': 'success', 'result': {'searched': True}}})}"

                elif event_type == "error":
                    message = getattr(event, "message", "Unknown API error")
                    yield f'data: {json.dumps({"error": "API Error", "message": message})}'
                    return

                elif event_type == "response.completed":
                    response = getattr(event, "response", None)
                    usage_data = {}
                    usage = getattr(response, "usage", None)
                    if usage is not None:
                        usage_data = {
                            "prompt_tokens": getattr(usage, "input_tokens", 0),
                            "completion_tokens": getattr(usage, "output_tokens", 0),
                            "total_tokens": getattr(usage, "total_tokens", 0),
                        }

                    finish_reason = "stop"
                    citations: list[dict] = []
                    for item in getattr(response, "output", []) or []:
                        item_type = getattr(item, "type", None)
                        if item_type == "function_call":
                            finish_reason = "tool_calls"
                            break  # tool-call response; no citations to collect
                        elif item_type == "message":
                            for part in getattr(item, "content", []) or []:
                                if getattr(part, "type", None) == "output_text":
                                    for ann in getattr(part, "annotations", []) or []:
                                        if getattr(ann, "type", None) == "url_citation":
                                            citations.append({
                                                "url": getattr(ann, "url", ""),
                                                "title": getattr(ann, "title", ""),
                                            })

                    if citations:
                        yield f"data: {json.dumps({'ray_citations': citations})}"

                    chunk_data: dict = {
                        "choices": [{"delta": {}, "index": 0, "finish_reason": finish_reason}],
                    }
                    if usage_data:
                        chunk_data["usage"] = usage_data
                    yield f"data: {json.dumps(chunk_data)}"

        except APIStatusError as exc:
            retry_after = None
            response = getattr(exc, "response", None)
            if response is not None:
                retry_after = response.headers.get("retry-after")
            if exc.status_code == 429 or 500 <= exc.status_code < 600:
                raise RetryableStreamError(
                    status=exc.status_code,
                    message=str(exc),
                    retry_after=retry_after,
                )
            yield f'data: {json.dumps({"error": "API Error", "message": str(exc), "status": exc.status_code})}'
            return
        except (APIConnectionError, APITimeoutError) as exc:
            raise RetryableStreamError(status=503, message=str(exc))

        yield "data: [DONE]"


class AzureOpenAIProvider(LLMProvider):
    """Azure OpenAI provider."""

    def __init__(self, endpoint: str, api_key: str, api_version: str,
                 deployment_caps: dict | None = None):
        self.endpoint = endpoint.rstrip("/")
        self.api_key = api_key
        self.api_version = api_version
        self._deployment_caps = deployment_caps or {}

    def build_url(self, model: str) -> str:
        return f"{self.endpoint}/openai/deployments/{model}/chat/completions?api-version={self.api_version}"

    def _supports_temperature(self, model: str) -> bool:
        caps = self._deployment_caps.get(model, {})
        return caps.get("supports_temperature", True)

    async def stream_chat(
        self,
        messages: list[dict],
        temperature: float,
        tools: list[dict] | None = None,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        resolved_model = model or get_default_model()
        url = self.build_url(resolved_model)
        headers = {
            "Content-Type": "application/json",
            "api-key": self.api_key,
        }
        body: dict = {
            "messages": messages,
            "stream": True,
            "stream_options": {"include_usage": True},
        }
        if self._supports_temperature(resolved_model):
            body["temperature"] = temperature
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"

        async with httpx.AsyncClient(verify=settings.tls_verify) as client:
            async with client.stream("POST", url, json=body, headers=headers, timeout=120) as resp:
                if resp.status_code != 200:
                    error_text = (await resp.aread()).decode()[:500]
                    if resp.status_code == 429 or 500 <= resp.status_code < 600:
                        raise RetryableStreamError(
                            status=resp.status_code,
                            message=error_text,
                            retry_after=resp.headers.get("retry-after"),
                        )
                    yield f'data: {json.dumps({"error": "API Error", "message": error_text, "status": resp.status_code})}'
                    return

                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        yield line


class OllamaProvider(LLMProvider):
    """Ollama local model provider. Converts to OpenAI SSE format."""

    def __init__(self, base_url: str = "http://ray-ollama:11434"):
        self.base_url = base_url.rstrip("/")

    def build_url(self, model: str) -> str:
        return f"{self.base_url}/api/chat"

    async def stream_chat(
        self,
        messages: list[dict],
        temperature: float,
        tools: list[dict] | None = None,
        model: str = "llama3",
    ) -> AsyncIterator[str]:
        url = self.build_url(model)
        body = {
            "model": model,
            "messages": messages,
            "stream": True,
            "options": {"temperature": temperature},
        }

        async with httpx.AsyncClient() as client:
            async with client.stream("POST", url, json=body, timeout=300) as resp:
                if resp.status_code != 200:
                    error_text = await resp.aread()
                    yield f'data: {json.dumps({"error": "Ollama Error", "message": error_text.decode()[:500]})}'
                    yield "data: [DONE]"
                    return

                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        event = json.loads(line)
                        content = event.get("message", {}).get("content", "")
                        if content:
                            openai_chunk = {
                                "choices": [{
                                    "delta": {"content": content},
                                    "index": 0,
                                }]
                            }
                            yield f"data: {json.dumps(openai_chunk)}"

                        if event.get("done"):
                            # Include usage if available
                            if "eval_count" in event:
                                openai_chunk = {
                                    "choices": [{"delta": {}, "index": 0, "finish_reason": "stop"}],
                                    "usage": {
                                        "prompt_tokens": event.get("prompt_eval_count", 0),
                                        "completion_tokens": event.get("eval_count", 0),
                                        "total_tokens": event.get("prompt_eval_count", 0) + event.get("eval_count", 0),
                                    },
                                }
                                yield f"data: {json.dumps(openai_chunk)}"
                            yield "data: [DONE]"
                            return
                    except json.JSONDecodeError:
                        pass


def get_provider(provider_type: str, config: dict) -> LLMProvider:
    """Create an LLM provider from config."""
    if provider_type == "openai":
        return OpenAIResponsesProvider(
            api_key=config.get("api_key", settings.openai_api_key),
            base_url=config.get("base_url", settings.openai_base_url),
        )
    elif provider_type == "azure_openai":
        deployment_caps = {}
        for dep in config.get("deployments", []):
            dep_id = dep.get("id", "")
            if dep_id:
                deployment_caps[dep_id] = {
                    "supports_temperature": dep.get("supports_temperature", True),
                }
        return AzureOpenAIProvider(
            endpoint=config.get("endpoint", settings.azure_openai_endpoint),
            api_key=config.get("api_key", settings.azure_openai_api_key),
            api_version=config.get("api_version", settings.azure_openai_api_version),
            deployment_caps=deployment_caps,
        )
    elif provider_type == "ollama":
        return OllamaProvider(base_url=config.get("base_url", "http://ray-ollama:11434"))
    else:
        raise ValueError(f"Unknown provider type: {provider_type}")


def resolve_model_provider(model_id: str) -> tuple[LLMProvider, str]:
    """Given a model ID, find its provider and return (provider, model_id)."""
    models_config = load_yaml("models.yaml")
    providers = models_config.get("providers", {})

    for provider_name, provider_config in providers.items():
        provider_type = provider_config.get("type", "")

        if provider_type == "openai":
            for configured_model in provider_config.get("models", []):
                if configured_model["id"] == model_id:
                    return get_provider(provider_type, provider_config), model_id

        elif provider_type == "azure_openai":
            for dep in provider_config.get("deployments", []):
                if dep["id"] == model_id:
                    return get_provider(provider_type, provider_config), model_id

        elif provider_type == "ollama":
            for m in provider_config.get("models", []):
                if m["id"] == model_id:
                    return get_provider(provider_type, provider_config), model_id

    # Fallback to the primary OpenAI provider
    return OpenAIResponsesProvider(
        api_key=settings.openai_api_key,
        base_url=settings.openai_base_url,
    ), model_id
