"""ContextVar storage for per-request correlation and request IDs."""
from contextvars import ContextVar

# Set by ObservabilityMiddleware on each request.
request_id_var: ContextVar[str] = ContextVar("ray_request_id", default="")
correlation_id_var: ContextVar[str] = ContextVar("ray_correlation_id", default="")


def get_request_id() -> str:
    return request_id_var.get()


def get_correlation_id() -> str:
    return correlation_id_var.get()
