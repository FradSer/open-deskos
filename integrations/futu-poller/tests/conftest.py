"""Make the poller module importable without installing it as a package."""

import os
import sys
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture(autouse=True)
def isolated_shared_preferences(tmp_path, monkeypatch):
    """Every CLI fixture excludes the operator's real startup preferences."""
    monkeypatch.setenv("OPEN_DESKOS_CONFIG_DIR", str(tmp_path / "shared-plugin-config"))
    monkeypatch.delenv("ODESK_DISABLED_PLUGINS", raising=False)
    monkeypatch.delenv("ODESK_FUTU_PLUGIN_CONFIG", raising=False)
