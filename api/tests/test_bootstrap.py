"""Tests for the bootstrap/onboarding system."""
from pathlib import Path
from unittest.mock import patch


def test_is_bootstrapped_false_when_no_identity(tmp_path):
    with patch("bootstrap.settings") as ms:
        ms.workspace_dir = tmp_path
        from bootstrap import is_bootstrapped
        import bootstrap
        bootstrap._bootstrapped_cache = None
        assert not is_bootstrapped()


def test_is_bootstrapped_true_when_identity_exists(tmp_path):
    (tmp_path / "IDENTITY.md").write_text("# Ray")
    with patch("bootstrap.settings") as ms:
        ms.workspace_dir = tmp_path
        import bootstrap
        bootstrap._bootstrapped_cache = None
        assert bootstrap.is_bootstrapped()


def test_mark_bootstrapped_creates_files(tmp_path):
    with patch("bootstrap.settings") as ms:
        ms.workspace_dir = tmp_path
        from bootstrap import mark_bootstrapped
        mark_bootstrapped("# IDENTITY\nRay", "# SOUL\nBe helpful.", "# USER\nAlan")
        assert (tmp_path / "IDENTITY.md").exists()
        assert (tmp_path / "SOUL.md").exists()
        assert (tmp_path / "USER.md").exists()
        assert "Ray" in (tmp_path / "IDENTITY.md").read_text()


def test_reset_bootstrap_removes_identity(tmp_path):
    (tmp_path / "IDENTITY.md").write_text("# Ray")
    template_dir = tmp_path / "workspace-template"
    template_dir.mkdir()
    (template_dir / "BOOTSTRAP.md").write_text("# Bootstrap")
    with patch("bootstrap.settings") as ms:
        ms.workspace_dir = tmp_path
        ms.config_dir = tmp_path  # config_dir.parent / workspace-template
        import bootstrap
        bootstrap._bootstrapped_cache = True
        bootstrap.reset_bootstrap()
        assert not (tmp_path / "IDENTITY.md").exists()
        assert bootstrap._bootstrapped_cache is None


def test_load_workspace_file_reads_from_workspace(tmp_path):
    (tmp_path / "SOUL.md").write_text("workspace version")
    with patch("agents.prompt_builder.settings") as ms:
        ms.workspace_dir = tmp_path
        from agents.prompt_builder import load_workspace_file
        assert load_workspace_file("SOUL.md") == "workspace version"


def test_load_workspace_file_returns_empty_for_missing(tmp_path):
    with patch("agents.prompt_builder.settings") as ms:
        ms.workspace_dir = tmp_path
        from agents.prompt_builder import load_workspace_file
        assert load_workspace_file("NONEXISTENT.md") == ""


def test_build_system_prompt_includes_identity(tmp_path):
    (tmp_path / "SOUL.md").write_text("# Soul\nBe helpful.")
    (tmp_path / "IDENTITY.md").write_text("# Identity\nName: Ray")
    (tmp_path / "USER.md").write_text("# User\nAlan")

    with patch("agents.prompt_builder.settings") as ms:
        ms.workspace_dir = tmp_path
        from agents.prompt_builder import build_system_prompt
        result = build_system_prompt("You are a general assistant.")
        assert "Soul" in result
        assert "Identity" in result
        assert "Alan" in result
        assert "Workspace" in result
        assert "Runtime" in result


def test_build_system_prompt_bootstrap_mode(tmp_path):
    (tmp_path / "BOOTSTRAP.md").write_text("Bootstrap prompt here.\n{existing_identity}")

    with patch("agents.prompt_builder.settings") as ms:
        ms.workspace_dir = tmp_path
        from agents.prompt_builder import build_system_prompt
        result = build_system_prompt("", bootstrap_mode=True)
        assert "Bootstrap prompt here" in result


def test_bootstrap_status_endpoint(client):
    resp = client.get("/api/identity/bootstrap-status")
    assert resp.status_code == 200
    data = resp.json()
    assert "bootstrapped" in data
    assert "has_existing_identity" in data


def test_bootstrap_status_command():
    import asyncio
    from commands.registry import execute_command
    result = asyncio.run(execute_command("bootstrap", "status", {}))
    assert "bootstrap" in result["content"].lower()


def test_bootstrap_reset_command():
    import asyncio
    from commands.registry import execute_command
    result = asyncio.run(execute_command("bootstrap", "reset", {}))
    assert "reset" in result["content"].lower()


def test_try_save_bootstrap(tmp_path):
    from unittest.mock import patch as _patch
    from routers.chat import _try_save_bootstrap

    text = (
        "Here are your files:\n\n"
        "---IDENTITY_START---\n# IDENTITY\n## Name\nTestBot\n---IDENTITY_END---\n\n"
        "---SOUL_START---\n# SOUL\nBe kind.\n---SOUL_END---\n\n"
        "---USER_START---\n# USER\nTester\n---USER_END---"
    )
    with _patch("bootstrap.settings") as ms:
        ms.workspace_dir = tmp_path
        import bootstrap
        bootstrap._bootstrapped_cache = None
        result = _try_save_bootstrap(text)
        assert result is True
        assert (tmp_path / "IDENTITY.md").exists()
        assert "TestBot" in (tmp_path / "IDENTITY.md").read_text()


def test_try_save_bootstrap_no_markers():
    from routers.chat import _try_save_bootstrap
    assert _try_save_bootstrap("Just a normal response") is False


def test_bootstrap_done_response_is_clean():
    """The /bootstrap done command should return 'Updated ...' and 'Hi {name}, how can I help?'."""
    import asyncio
    from commands.registry import execute_command
    from unittest.mock import patch as _patch, MagicMock

    # Simulate a conversation with bootstrap markers
    fake_conv = {
        "messages": [
            {"role": "user", "content": "My name is Alan"},
            {
                "role": "assistant",
                "content": (
                    "---IDENTITY_START---\n# IDENTITY\nRay\n---IDENTITY_END---\n\n"
                    "---SOUL_START---\n# SOUL\nBe helpful.\n---SOUL_END---\n\n"
                    "---USER_START---\n# USER\n**Name:** Alan\n---USER_END---"
                ),
            },
        ]
    }

    with _patch("memory.conversation.get_conversation", return_value=fake_conv), \
         _patch("bootstrap.mark_bootstrapped"):
        result = asyncio.run(execute_command(
            "bootstrap", "done", {"conversation_id": "test-id"}
        ))
    assert "Updated" in result["content"]
    assert "IDENTITY.md" in result["content"]
    assert "Hi Alan, how can I help?" in result["content"]
    # Must NOT contain raw markdown file content
    assert "---IDENTITY_START---" not in result["content"]
    assert "# SOUL" not in result["content"]


def test_bootstrap_done_redirect_has_finalize_flag():
    """When no markers found, redirect should include bootstrap_finalize flag."""
    import asyncio
    from commands.registry import execute_command
    from unittest.mock import patch as _patch

    with _patch("memory.conversation.get_conversation", return_value={"messages": []}):
        result = asyncio.run(execute_command(
            "bootstrap", "done", {"conversation_id": "test-id"}
        ))
    assert result.get("type") == "redirect"
    assert result.get("bootstrap_finalize") is True


def test_build_workspace_context_includes_identity_files(tmp_path):
    (tmp_path / "SOUL.md").write_text("# Soul\nBe direct.")
    (tmp_path / "IDENTITY.md").write_text("# Identity\nRay")
    (tmp_path / "USER.md").write_text("# User\nAlan")

    with patch("agents.prompt_builder.settings") as ms:
        ms.workspace_dir = tmp_path
        from agents.prompt_builder import build_workspace_context
        result = build_workspace_context()
        assert "Soul" in result
        assert "Identity" in result
        assert "Alan" in result
        assert "Workspace" in result


def test_mark_bootstrapped_deletes_bootstrap_md(tmp_path):
    (tmp_path / "BOOTSTRAP.md").write_text("# Bootstrap")
    with patch("bootstrap.settings") as ms:
        ms.workspace_dir = tmp_path
        from bootstrap import mark_bootstrapped
        mark_bootstrapped("# IDENTITY\nRay", "# SOUL", "# USER")
        assert not (tmp_path / "BOOTSTRAP.md").exists()
        assert (tmp_path / "IDENTITY.md").exists()
