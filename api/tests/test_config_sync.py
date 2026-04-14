"""Tests for config sync (config_sync.py)."""
from pathlib import Path
from unittest.mock import patch

import yaml


def _write_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        yaml.dump(data, f, sort_keys=False)


def test_sync_adds_new_file(tmp_path):
    upstream = tmp_path / "upstream"
    config = tmp_path / "config"
    workspace = tmp_path / "workspace"
    upstream.mkdir()
    config.mkdir()
    workspace.mkdir()

    _write_yaml(upstream / "tools.yaml", {"tools": [{"name": "web_fetch"}]})

    with patch("config_sync.settings") as ms:
        ms.config_dir = config
        ms.workspace_dir = workspace
        from config_sync import ensure_config_synced
        result = ensure_config_synced(upstream_dir=upstream)

    assert "tools.yaml" in result
    assert "added" in result["tools.yaml"]
    assert (config / "tools.yaml").exists()


def test_sync_merges_yaml_preserving_overrides(tmp_path):
    upstream = tmp_path / "upstream"
    config = tmp_path / "config"
    workspace = tmp_path / "workspace"
    upstream.mkdir()
    config.mkdir()
    workspace.mkdir()

    _write_yaml(upstream / "models.yaml", {
        "default_model": "gpt-5-mini",
        "providers": {"openai": {"models": [{"id": "gpt-5-mini"}]}},
    })
    _write_yaml(config / "models.yaml", {
        "default_model": "gpt-5-nano",
        "providers": {"openai": {"models": [{"id": "old-model"}]}},
    })

    with patch("config_sync.settings") as ms:
        ms.config_dir = config
        ms.workspace_dir = workspace
        from config_sync import ensure_config_synced
        result = ensure_config_synced(upstream_dir=upstream)

    assert "models.yaml" in result
    assert "preserved" in result["models.yaml"]

    with open(config / "models.yaml") as f:
        merged = yaml.safe_load(f)
    # default_model should be preserved from deployment
    assert merged["default_model"] == "gpt-5-nano"
    # providers should be updated from upstream
    assert merged["providers"]["openai"]["models"][0]["id"] == "gpt-5-mini"


def test_sync_skips_identical_files(tmp_path):
    upstream = tmp_path / "upstream"
    config = tmp_path / "config"
    workspace = tmp_path / "workspace"
    upstream.mkdir()
    config.mkdir()
    workspace.mkdir()

    _write_yaml(upstream / "tools.yaml", {"tools": [{"name": "calc"}]})
    _write_yaml(config / "tools.yaml", {"tools": [{"name": "calc"}]})

    with patch("config_sync.settings") as ms:
        ms.config_dir = config
        ms.workspace_dir = workspace
        from config_sync import ensure_config_synced
        result = ensure_config_synced(upstream_dir=upstream)

    assert result == {}


def test_sync_skips_when_no_upstream(tmp_path):
    with patch("config_sync.settings") as ms:
        ms.config_dir = tmp_path / "config"
        ms.workspace_dir = tmp_path / "workspace"
        from config_sync import ensure_config_synced
        result = ensure_config_synced(upstream_dir=tmp_path / "nonexistent")

    assert result == {}


def test_sync_skips_grafana_subdirectory(tmp_path):
    upstream = tmp_path / "upstream"
    config = tmp_path / "config"
    workspace = tmp_path / "workspace"
    upstream.mkdir()
    config.mkdir()
    workspace.mkdir()

    (upstream / "grafana").mkdir()
    (upstream / "grafana" / "dashboard.json").write_text("{}")

    with patch("config_sync.settings") as ms:
        ms.config_dir = config
        ms.workspace_dir = workspace
        from config_sync import ensure_config_synced
        result = ensure_config_synced(upstream_dir=upstream)

    assert result == {}
    assert not (config / "grafana" / "dashboard.json").exists()


def test_workspace_seeded_updates_changed_templates(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    template = tmp_path / "template"
    template.mkdir()

    # Seed initial file
    (template / "TOOLS.md").write_text("v1")
    (ws / "TOOLS.md").write_text("v1")

    # Update template
    (template / "TOOLS.md").write_text("v2 with new tools")

    with patch("bootstrap.settings") as ms, \
         patch("bootstrap._TEMPLATE_DIR", template):
        ms.workspace_dir = ws
        from bootstrap import ensure_workspace_seeded
        ensure_workspace_seeded()

    assert (ws / "TOOLS.md").read_text() == "v2 with new tools"


def test_workspace_seeded_preserves_user_edited_files(tmp_path):
    ws = tmp_path / "workspace"
    ws.mkdir()
    template = tmp_path / "template"
    template.mkdir()

    # User has customised SOUL.md
    (template / "SOUL.md").write_text("default soul")
    (ws / "SOUL.md").write_text("my custom soul")

    with patch("bootstrap.settings") as ms, \
         patch("bootstrap._TEMPLATE_DIR", template):
        ms.workspace_dir = ws
        from bootstrap import ensure_workspace_seeded
        ensure_workspace_seeded()

    # Should NOT be overwritten
    assert (ws / "SOUL.md").read_text() == "my custom soul"
