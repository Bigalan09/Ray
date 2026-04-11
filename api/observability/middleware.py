"""HTTP observability middleware: request logging, correlation IDs, and metrics."""
from __future__ import annotations

import time
import uuid

import structlog
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .context import request_id_var, correlation_id_var
from .metrics import http_requests_total, http_request_duration
from .setup import get_log_config

log = structlog.get_logger("ray.http")


def _normalize_path(path: str) -> str:
    """Collapse dynamic path segments to reduce metric cardinality."""
    import re
    # Replace UUIDs and numeric IDs: /conversations/abc123 -> /conversations/{id}
    path = re.sub(r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", "/{id}", path)
    path = re.sub(r"/\d+", "/{id}", path)
    return path


class ObservabilityMiddleware(BaseHTTPMiddleware):
    """Injects correlation IDs, logs requests, and records Prometheus metrics."""

    def __init__(self, app, exclude_paths: list[str] | None = None):
        super().__init__(app)
        cfg = get_log_config()
        self.log_requests: bool = cfg.get("enable_request_logging", True)
        self.slow_threshold_ms: float = cfg.get("slow_request_threshold_ms", 5000)
        self.metrics_enabled: bool = bool(cfg.get("metrics_path", "/metrics"))
        self.exclude_paths: set[str] = set(
            cfg.get("request_log_exclude_paths", ["/health", "/metrics", "/favicon.ico"])
        )
        if exclude_paths:
            self.exclude_paths.update(exclude_paths)

    async def dispatch(self, request: Request, call_next) -> Response:
        req_id = str(uuid.uuid4()).replace("-", "")[:12]
        corr_id = (
            request.headers.get("X-Correlation-ID")
            or request.headers.get("X-Request-ID")
            or req_id
        )

        request_id_var.set(req_id)
        correlation_id_var.set(corr_id)

        path = request.url.path
        method = request.method
        should_log = self.log_requests and path not in self.exclude_paths
        start = time.perf_counter()
        status_code = 500

        try:
            response = await call_next(request)
            status_code = response.status_code

            # Propagate IDs in response headers so clients can correlate
            response.headers["X-Request-ID"] = req_id
            response.headers["X-Correlation-ID"] = corr_id
            return response
        except Exception:
            raise
        finally:
            duration_ms = (time.perf_counter() - start) * 1000

            if should_log:
                log_fn = log.warning if duration_ms > self.slow_threshold_ms else log.info
                log_fn(
                    "http_request",
                    method=method,
                    path=path,
                    status=status_code,
                    duration_ms=round(duration_ms, 2),
                    slow=duration_ms > self.slow_threshold_ms,
                    client_ip=request.client.host if request.client else None,
                )

            if self.metrics_enabled:
                try:
                    norm_path = _normalize_path(path)
                    http_requests_total.labels(
                        method=method, path=norm_path, status=str(status_code)
                    ).inc()
                    http_request_duration.labels(method=method, path=norm_path).observe(
                        duration_ms / 1000
                    )
                except Exception:
                    pass
