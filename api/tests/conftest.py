import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Ensure the api package is importable
sys.path.insert(0, str(Path(__file__).parent.parent))

# Load the root .env file so local test runs pick up any configured credentials
_env_file = Path(__file__).parent.parent.parent / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value

# Set test directories
os.environ["CONFIG_DIR"] = str(Path(__file__).parent.parent.parent / "config")
# Use the actual workspace for tests (it has the bootstrapped identity files)
_workspace_dir = str(Path(__file__).parent.parent.parent / "workspace")
# If workspace doesn't have SOUL.md, the templates haven't been seeded yet
# In that case, copy from workspace-template
_template_dir = Path(__file__).parent.parent.parent / "workspace-template"
_ws_path = Path(_workspace_dir)
if _template_dir.exists() and not (_ws_path / "SOUL.md").exists():
    _ws_path.mkdir(parents=True, exist_ok=True)
    import shutil
    for src in _template_dir.rglob("*"):
        if src.is_file():
            dest = _ws_path / src.relative_to(_template_dir)
            if not dest.exists():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)

os.environ["WORKSPACE_DIR"] = _workspace_dir
os.environ["DATA_DIR"] = _workspace_dir


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """Clear in-memory rate limit counters between tests."""
    from security.rate_limit import _fallback
    _fallback.clear()


@pytest.fixture
def client():
    import config
    from sse_starlette.sse import AppStatus

    AppStatus.should_exit = False
    AppStatus.should_exit_event = None
    config.settings.data_dir = Path(_workspace_dir)
    config.settings.workspace_dir = Path(_workspace_dir)
    config.settings.config_dir = Path(os.environ["CONFIG_DIR"])

    from main import app
    return TestClient(app)
