"""Tests for /file slash command."""
import asyncio
import tempfile
from pathlib import Path
from unittest.mock import patch


def _run(coro):
    return asyncio.run(coro)


def test_file_list_workspace(tmp_path):
    (tmp_path / "readme.md").write_text("hello")
    (tmp_path / "subdir").mkdir()

    with patch("commands.file_ops._workspace_root", return_value=tmp_path):
        from commands.registry import execute_command
        result = _run(execute_command("file", "list", {}))
        assert "readme.md" in result["content"]
        assert "[dir]" in result["content"]


def test_file_read(tmp_path):
    (tmp_path / "test.py").write_text("print('hello')")

    with patch("commands.file_ops._workspace_root", return_value=tmp_path):
        from commands.registry import execute_command
        result = _run(execute_command("file", "read test.py", {}))
        assert "print('hello')" in result["content"]
        assert "test.py" in result["content"]


def test_file_read_traversal_rejected(tmp_path):
    with patch("commands.file_ops._workspace_root", return_value=tmp_path):
        from commands.registry import execute_command
        result = _run(execute_command("file", "read ../../etc/passwd", {}))
        assert result.get("error") is True
        assert "Access denied" in result["content"]


def test_file_read_not_found(tmp_path):
    with patch("commands.file_ops._workspace_root", return_value=tmp_path):
        from commands.registry import execute_command
        result = _run(execute_command("file", "read nonexistent.txt", {}))
        assert result.get("error") is True
        assert "not found" in result["content"]


def test_file_search(tmp_path):
    (tmp_path / "app.py").write_text("code")
    (tmp_path / "lib").mkdir()
    (tmp_path / "lib" / "utils.py").write_text("more code")

    with patch("commands.file_ops._workspace_root", return_value=tmp_path):
        from commands.registry import execute_command
        result = _run(execute_command("file", "search *.py", {}))
        assert "app.py" in result["content"]
        assert "utils.py" in result["content"]


def test_file_no_args():
    from commands.registry import execute_command
    result = _run(execute_command("file", "", {}))
    assert "Usage" in result["content"]
