"""Persistent component preferences use isolated local files."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
import poller


def invoke(*args):
    env = {**os.environ, "FUTU_PORT": "invalid", "FUTU_TRADE_PWD": "private-fixture-password"}
    return subprocess.run([sys.executable, poller.__file__, *map(str, args)], env=env,
                          capture_output=True, text=True, timeout=10)


def test_cli_persists_selection_and_preserves_independent_components(tmp_path):
    file = tmp_path / "plugins.json"
    for identity in ("odk.futu.publisher", "odk.futu.gateway"):
        result = invoke("--plugins", "disable", "--plugin", identity, "--plugin-config", file)
        assert result.returncode == 0, result.stderr
        report = json.loads(result.stdout)
        assert report == {"host": "python-agent", "scope": "preferences", "pluginId": identity,
                          "enabled": False, "applies": "next-startup"}
    result = invoke("--plugins", "list", "--plugin-config", file)
    assert result.returncode == 0, result.stderr
    assert {entry["manifest"]["id"] for entry in json.loads(result.stdout)["plugins"] if not entry["enabled"]} == {"odk.futu.publisher", "odk.futu.gateway"}
    result = invoke("--plugins", "enable", "--plugin", "odk.futu.gateway", "--plugin-config", file)
    assert result.returncode == 0, result.stderr
    saved = json.loads(file.read_text())
    assert saved["plugins"]["odk.futu.publisher"]["enabled"] is False
    assert saved["plugins"]["odk.futu.gateway"]["enabled"] is True
    assert "private-fixture" not in file.read_text()
    if os.name != "nt": assert file.stat().st_mode & 0o777 == 0o600


def test_saved_selection_controls_operational_composition_without_opening_disabled_gateway(tmp_path):
    file = tmp_path / "plugins.json"
    file.write_text(json.dumps({"version": 1, "plugins": {"odk.futu.gateway": {"enabled": False}}}))
    def forbidden(_context): raise AssertionError("disabled provider ran")
    class Publisher:
        def send(self, _record): pass
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture", "ODESK_FUTU_PLUGIN_CONFIG": str(file)},
                                  gateway_factory=forbidden, publisher_factory=lambda ctx: Publisher())
    states = {item["manifest"]["id"]: item["state"] for item in runtime.start()}
    assert states == {"odk.futu.publisher": "running", "odk.futu.gateway": "disabled", "odk.futu.loop": "blocked", "odk.futu.transport": "running"}
    runtime.close()


def test_writer_refuses_an_owned_lock_and_unknown_ids_without_changing_file(tmp_path):
    file = tmp_path / "plugins.json"
    content = '{"version":1,"plugins":{}}'
    file.write_text(content)
    lock = Path(str(file) + ".lock")
    lock.mkdir()
    result = invoke("--plugins", "disable", "--plugin", "odk.futu.gateway", "--plugin-config", file)
    assert result.returncode == 2
    assert "busy" in result.stderr
    assert file.read_text() == content
    assert lock.is_dir()
    lock.rmdir()
    result = invoke("--plugins", "disable", "--plugin", "odk.futu.unknown", "--plugin-config", file)
    assert result.returncode == 2
    assert file.read_text() == content
    assert not lock.exists()


def test_bad_startup_config_is_rejected_before_any_factory(tmp_path):
    file = tmp_path / "plugins.json"
    file.write_text('{"version":1,"plugins":{"odk.futu.gateway":{"enabled":"false"}}}')
    def forbidden(_context): raise AssertionError("factory ran")
    with pytest.raises(ValueError, match="plugin configuration"):
        poller.create_poller({"ODESK_FUTU_PLUGIN_CONFIG": str(file)}, publisher_factory=forbidden)


def test_atomic_write_failure_preserves_file_and_removes_only_owned_artifacts(tmp_path, monkeypatch):
    import plugin_config
    file = tmp_path / "plugins.json"
    content = '{"version":1,"plugins":{"odk.futu.publisher":{"enabled":false}}}'
    file.write_text(content)
    def fail(_source, _target): raise OSError("fixture replace failure")
    monkeypatch.setattr(plugin_config.os, "replace", fail)
    with pytest.raises(OSError, match="fixture replace failure"):
        plugin_config.update_enabled(file, "odk.futu.gateway", False, {"odk.futu.gateway", "odk.futu.publisher"})
    assert file.read_text() == content
    assert sorted(item.name for item in tmp_path.iterdir()) == ["plugins.json"]


def test_config_bounds_and_invalid_content_fail_without_writes(tmp_path):
    import plugin_config
    file = tmp_path / "plugins.json"
    known = {"odk.futu.gateway"}
    for content in [' ' * 16385, '{"version":true,"plugins":{}}',
                    '{"version":1,"plugins":{"odk.futu.unknown":{"enabled":true}}}',
                    '{"version":1,"plugins":{},"plugins":{}}', '{']:
        file.write_text(content)
        with pytest.raises(ValueError, match="plugin configuration"):
            plugin_config.update_enabled(file, "odk.futu.gateway", False, known)
        assert file.read_text() == content
        assert not Path(str(file) + ".lock").exists()


def test_symlink_alias_uses_target_lock_and_preserves_alias(tmp_path):
    import plugin_config
    target = tmp_path / "target.json"
    alias = tmp_path / "alias.json"
    target.write_text('{"version":1,"plugins":{}}')
    try: alias.symlink_to(target)
    except OSError: pytest.skip("symlink creation is unavailable")
    lock = Path(str(target) + ".lock")
    lock.mkdir()
    with pytest.raises(ValueError, match="busy"):
        plugin_config.update_enabled(alias, "odk.futu.gateway", False, {"odk.futu.gateway"})
    assert lock.exists()
    lock.rmdir()
    plugin_config.update_enabled(alias, "odk.futu.gateway", False, {"odk.futu.gateway"})
    assert alias.is_symlink()
    assert json.loads(target.read_text())["plugins"]["odk.futu.gateway"]["enabled"] is False


def test_cli_mutation_requires_explicit_file_and_cannot_run_operational_settings(tmp_path):
    result = invoke("--plugins", "disable", "--plugin", "odk.futu.gateway")
    assert result.returncode == 2
    assert "requires --plugin and --plugin-config" in result.stderr
    assert result.stdout == ""


def test_no_configuration_file_preserves_default_selection(tmp_path):
    import plugin_config
    assert plugin_config.read_config(tmp_path / "missing.json", {"odk.futu.gateway"}) == {"version": 1, "plugins": {}}


def test_concurrent_writer_cannot_remove_lock_or_overwrite_other_selection(tmp_path, monkeypatch):
    import plugin_config
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event
    file = tmp_path / "plugins.json"
    known = {"odk.futu.publisher", "odk.futu.gateway"}
    entered, release = Event(), Event()
    original = plugin_config.os.replace
    def replace(source, target):
        entered.set()
        assert release.wait(5), "writer gate was not released"
        original(source, target)
    monkeypatch.setattr(plugin_config.os, "replace", replace)
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(plugin_config.update_enabled, file, "odk.futu.publisher", False, known)
        try:
            assert entered.wait(5), "writer did not reach replacement"
            with pytest.raises(ValueError, match="busy"):
                plugin_config.update_enabled(file, "odk.futu.gateway", False, known)
            assert Path(str(file) + ".lock").is_dir()
        finally:
            release.set()
        future.result(timeout=5)
    monkeypatch.setattr(plugin_config.os, "replace", original)
    plugin_config.update_enabled(file, "odk.futu.gateway", False, known)
    assert json.loads(file.read_text())["plugins"] == {
        "odk.futu.publisher": {"enabled": False}, "odk.futu.gateway": {"enabled": False}}
    assert not Path(str(file) + ".lock").exists()
