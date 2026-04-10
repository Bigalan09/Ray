"""Tests for retry helpers and error handling in chat.py."""


def test_parse_wait_time_from_retry_after_header():
    from routers.chat import _parse_wait_time
    assert _parse_wait_time("", "30") == 30.0
    assert _parse_wait_time("", "1.5") == 1.5


def test_parse_wait_time_from_error_text_seconds():
    from routers.chat import _parse_wait_time
    result = _parse_wait_time("Please retry after 10 seconds")
    assert result == 10.0


def test_parse_wait_time_from_error_text_minutes():
    from routers.chat import _parse_wait_time
    result = _parse_wait_time("retry after 2 minutes")
    assert result == 120.0


def test_parse_wait_time_from_error_text_ms():
    from routers.chat import _parse_wait_time
    result = _parse_wait_time("retry after 500 ms")
    assert result == 0.5


def test_parse_wait_time_no_match():
    from routers.chat import _parse_wait_time
    assert _parse_wait_time("some random error") == 0


def test_is_retryable_429():
    from routers.chat import _is_retryable
    assert _is_retryable(429) is True


def test_is_retryable_500():
    from routers.chat import _is_retryable
    assert _is_retryable(500) is True
    assert _is_retryable(502) is True
    assert _is_retryable(503) is True


def test_is_retryable_400_not_retryable():
    from routers.chat import _is_retryable
    assert _is_retryable(400) is False
    assert _is_retryable(401) is False
    assert _is_retryable(404) is False


def test_sse_error_format():
    import json
    from routers.chat import _sse_error
    event = _sse_error("Something went wrong", retryable=True)
    parsed = json.loads(event["data"])
    assert parsed["type"] == "error"
    assert parsed["message"] == "Something went wrong"
    assert parsed["retryable"] is True


def test_retryable_stream_error():
    from llm.providers import RetryableStreamError
    exc = RetryableStreamError(429, "Rate limited", retry_after="30")
    assert exc.status == 429
    assert exc.retry_after == "30"
    assert "429" in str(exc)
