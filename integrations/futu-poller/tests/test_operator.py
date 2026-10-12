"""Operator inspection never starts the real SDK or channels."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
import poller


def test_operator_inventory_and_validation_do_not_read_provider_settings():
    script = Path(poller.__file__)
    env = {**os.environ, "FUTU_TRADE_PWD": "private-fixture-password", "FUTU_PORT": "invalid",
           "ODESK_FUTU_SOCKET": "/private/fixture/channel"}
    for operation in ("list", "validate"):
        result = subprocess.run([sys.executable, str(script), "--plugins", operation,
                                 "--disable-plugin", "odk.futu.gateway"], env=env,
                                capture_output=True, text=True, timeout=10, check=True)
        report = json.loads(result.stdout)
        assert report["scope"] == "declarations"
        assert report["host"] == "python-agent"
        assert report["validated"] is (operation == "validate")
        assert len(report["plugins"]) == 4
        assert all(item["state"] == "registered" for item in report["plugins"])
        gateway = next(item for item in report["plugins"] if item["manifest"]["id"] == "odk.futu.gateway")
        assert gateway["enabled"] is False
        assert "private-fixture" not in result.stdout
        assert "private/fixture" not in result.stdout


def test_startup_disable_excludes_factory_and_blocks_only_required_consumers():
    events = []
    class Publisher:
        def send(self, _record): pass
        def close(self): events.append("close")
    def forbidden(_context): raise AssertionError("disabled SDK factory ran")
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture"},
                                  publisher_factory=lambda context: Publisher(), gateway_factory=forbidden,
                                  disabled=("odk.futu.gateway",))
    catalog = {entry["manifest"]["id"]: entry for entry in runtime.start()}
    assert catalog["odk.futu.gateway"]["state"] == "disabled"
    assert catalog["odk.futu.loop"]["state"] == "blocked"
    assert catalog["odk.futu.publisher"]["state"] == "running"
    runtime.close()
    assert events == ["close"]


def test_unknown_startup_identity_is_rejected_without_factory_execution():
    def forbidden(_context): raise AssertionError("factory ran")
    with pytest.raises(ValueError, match="unknown disabled plugin"):
        poller.create_poller({}, publisher_factory=forbidden, disabled=("odk.futu.unknown",))


def test_default_command_still_runs_the_operational_composition(monkeypatch):
    calls = []
    class Runtime:
        def run(self): calls.append("run")
    def create(env=None, **options):
        calls.append((env, options))
        return Runtime()
    monkeypatch.setattr(poller, "create_poller", create)
    poller.main([])
    assert calls == [(None, {"disabled": ()}), "run"]


def test_operator_rejects_unknown_identity_without_inspection_output():
    result = subprocess.run([sys.executable, poller.__file__, "--plugins", "list",
                             "--disable-plugin", "odk.futu.unknown"],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 2
    assert "unknown disabled plugin" in result.stderr
    assert result.stdout == ""
