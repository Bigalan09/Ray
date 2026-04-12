"""Prometheus metrics registry for Ray."""
from prometheus_client import Counter, Histogram, CollectorRegistry

REGISTRY = CollectorRegistry(auto_describe=True)

# --- HTTP layer ---

http_requests_total = Counter(
    "ray_http_requests_total",
    "Total HTTP requests processed",
    ["method", "path", "status"],
    registry=REGISTRY,
)

http_request_duration = Histogram(
    "ray_http_request_duration_seconds",
    "HTTP request processing time in seconds",
    ["method", "path"],
    buckets=[0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registry=REGISTRY,
)

# --- LLM layer ---

llm_requests_total = Counter(
    "ray_llm_requests_total",
    "Total requests sent to LLM providers",
    ["model", "provider", "finish_reason"],
    registry=REGISTRY,
)

llm_request_duration = Histogram(
    "ray_llm_request_duration_seconds",
    "Time from LLM request start to completion",
    ["model", "provider"],
    buckets=[0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120],
    registry=REGISTRY,
)

llm_tokens_total = Counter(
    "ray_llm_tokens_total",
    "Total tokens consumed from LLM providers",
    ["model", "provider", "type"],  # type: prompt | completion
    registry=REGISTRY,
)

llm_retries_total = Counter(
    "ray_llm_retries_total",
    "Total LLM request retries (rate-limit or server errors)",
    ["model", "provider", "status"],
    registry=REGISTRY,
)

# --- Tool layer ---

tool_calls_total = Counter(
    "ray_tool_calls_total",
    "Total tool invocations",
    ["tool", "status"],  # status: success | error
    registry=REGISTRY,
)

tool_call_duration = Histogram(
    "ray_tool_call_duration_seconds",
    "Tool execution time in seconds",
    ["tool"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registry=REGISTRY,
)

# --- Chat layer ---

chat_requests_total = Counter(
    "ray_chat_requests_total",
    "Total chat requests received",
    ["agent", "has_tools"],
    registry=REGISTRY,
)

chat_tool_rounds_total = Counter(
    "ray_chat_tool_rounds_total",
    "Total tool-call rounds in chat completions",
    ["agent"],
    registry=REGISTRY,
)

chat_response_duration = Histogram(
    "ray_chat_response_duration_seconds",
    "Total time from first user token to final assistant token (including all tool rounds)",
    ["agent", "outcome"],  # outcome: success | error
    buckets=[0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300],
    registry=REGISTRY,
)
