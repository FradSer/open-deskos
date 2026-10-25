"""Common CLI preferences reach isolated Python startup and inspection."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

import pytest
import poller

CLI = Path(__file__).resolve().parents[3] / "runtime/shell/scripts/odk-plugin-cli.js"


def fixture_env(tmp_path: Path) -> dict[str, str]:
    return {**os.environ, "ODK_CONFIG_DIR": str(tmp_path), "ODK_DISABLED_PLUGINS": "",
            "ODK_FUTU_PLUGIN_CONFIG": "", "FUTU_PORT": "private-invalid-port",
            "FUTU_TRADE_PWD": "private-fixture-password", "ODK_FUTU_SOCKET": "/private/fixture/channel"}


def command(env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, poller.__file__, "--plugins", "list", *args], env=env,
                          capture_output=True, text=True, timeout=10)


def disabled(result: subprocess.CompletedProcess[str]) -> set[str]:
    assert result.returncode == 0, result.stderr
    assert "private-fixture" not in result.stdout
    assert "private-invalid" not in result.stdout
    assert "private/fixture" not in result.stdout
    return {entry["manifest"]["id"] for entry in json.loads(result.stdout)["plugins"] if not entry["enabled"]}


def test_actual_common_cli_disable_enable_and_environment_exclusion(tmp_path):
    env = fixture_env(tmp_path)
    node = shutil.which("node")
    assert node is not None, "the shared CLI acceptance requires Node"
    for operation, expected in [("disable", {"odk.futu.gateway"}), ("enable", set())]:
        subprocess.run([node, str(CLI), operation, "odk.futu.gateway"], env=env,
                       capture_output=True, text=True, timeout=10, check=True)
        assert disabled(command(env)) == expected
    env["ODK_DISABLED_PLUGINS"] = "odk.futu.gateway, odk.source.weather odk.personal-agent.home"
    assert disabled(command(env)) == {"odk.futu.gateway"}


def test_common_selection_combines_standalone_cli_and_environment_disables(tmp_path):
    env = fixture_env(tmp_path)
    shared = tmp_path / "plugins.json"
    shared.write_text(json.dumps({"version": 1, "plugins": {
        "odk.futu.gateway": {"enabled": True}, "odk.futu.publisher": {"enabled": False},
        "odk.source.weather": {"enabled": False, "development": {"entry": "must-not-execute"}},
    }}))
    local = tmp_path / "local.json"
    local.write_text(json.dumps({"version": 1, "plugins": {"odk.futu.gateway": {"enabled": False}}}))
    env["ODK_FUTU_PLUGIN_CONFIG"] = str(local)
    env["ODK_DISABLED_PLUGINS"] = "odk.futu.loop"
    assert disabled(command(env, "--disable-plugin", "odk.futu.transport")) == {
        "odk.futu.gateway", "odk.futu.publisher", "odk.futu.loop", "odk.futu.transport"}
    override = tmp_path / "override.json"
    override.write_text('{"version":1,"plugins":{}}')
    assert disabled(command(env, "--plugin-config", str(override))) == {
        "odk.futu.publisher", "odk.futu.loop"}
    assert "must-not-execute" not in command(env).stdout


@pytest.mark.parametrize("content", ['{private-invalid', '{"version":true,"plugins":{}}',
    '{"version":1,"plugins":{"odk.futu.gateway":{"enabled":"false"}}}',
    '{"version":1,"plugins":{"bad identity":{"enabled":false}}}',
    '{"version":1,"plugins":{"odk.futu.gateway":{"enabled":"false"}},"metadata":' + '[' * 10000 + '0' + ']' * 10000 + '}',
    '{"version":1,"plugins":{},"metadata":NaN}',
    '{"version":1,"plugins":{},"metadata":Infinity}',
    '{"version":1,"plugins":{},"metadata":-Infinity}'],
    ids=["invalid-json", "invalid-version", "invalid-enabled", "invalid-identity", "deep-invalid-enabled", "nan", "infinity", "negative-infinity"])
def test_bad_shared_configuration_keeps_explicit_disables_and_private_diagnostic(tmp_path, content):
    env = fixture_env(tmp_path)
    (tmp_path / "plugins.json").write_text(content)
    result = command(env, "--disable-plugin", "odk.futu.gateway")
    assert disabled(result) == {"odk.futu.gateway"}
    assert "plugin configuration unavailable" in result.stderr
    assert "private-invalid" not in result.stderr
    assert (tmp_path / "plugins.json").read_text() == content


def test_shared_parser_nesting_failure_keeps_disables_and_private_diagnostic(tmp_path, monkeypatch):
    import plugin_config
    from types import SimpleNamespace
    env = fixture_env(tmp_path)
    env["ODK_DISABLED_PLUGINS"] = "odk.futu.gateway"
    file = tmp_path / "plugins.json"
    content = '{"version":1,"plugins":{"odk.futu.publisher":{"enabled":false}}}'
    file.write_text(content)
    def reject_nesting(*_args, **_kwargs):
        raise RecursionError("private parser nesting limit")
    monkeypatch.setattr(plugin_config, "json", SimpleNamespace(loads=reject_nesting))
    messages = []
    selected = plugin_config.resolve_shared_disabled(env, {"odk.futu.gateway", "odk.futu.publisher"}, messages.append)
    assert selected == ("odk.futu.gateway",)
    assert messages == ["plugin configuration unavailable"]
    assert file.read_text() == content


def test_operational_entry_applies_preferences_before_disabled_factories(tmp_path, monkeypatch):
    env = fixture_env(tmp_path)
    (tmp_path / "plugins.json").write_text('{"version":1,"plugins":{"odk.futu.gateway":{"enabled":false}}}')
    env["FUTU_PORT"] = "11111"
    env.pop("ODK_FUTU_SOCKET")
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    real_create = poller.create_poller
    events = []
    class Publisher:
        def send(self, _record): pass
        def close(self): events.append("closed")
    def forbidden(_context): raise AssertionError("disabled factory ran")
    def create(env=None, **options):
        runtime = real_create(env, publisher_factory=lambda context: Publisher(), gateway_factory=forbidden,
                              loop_factory=forbidden, **options)
        def run():
            catalog = {item["manifest"]["id"]: item["state"] for item in runtime.start()}
            assert catalog["odk.futu.gateway"] == "disabled"
            assert catalog["odk.futu.loop"] == "blocked"
            assert catalog["odk.futu.publisher"] == "running"
            runtime.close()
        runtime.run = run
        return runtime
    monkeypatch.setattr(poller, "create_poller", create)
    poller.main([])
    assert events == ["closed"]


def test_missing_shared_config_preserves_default_inspection(tmp_path):
    result = command(fixture_env(tmp_path))
    assert disabled(result) == set()
    assert result.stderr == ""


@pytest.mark.parametrize("env_key", ["ODK_CONFIG_DIR", "HOME", "USERPROFILE", None])
def test_shared_path_matches_shell_precedence(tmp_path, monkeypatch, env_key):
    from plugin_config import resolve_shared_config_path
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path / "fallback"))
    env = {} if env_key is None else {env_key: str(tmp_path / env_key)}
    actual = resolve_shared_config_path(env)
    expected = (tmp_path / "ODK_CONFIG_DIR" / "plugins.json") if env_key == "ODK_CONFIG_DIR" else (
        tmp_path / (env_key or "fallback") / ".config" / "odk" / "plugins.json")
    assert actual == expected
    assert resolve_shared_config_path({"ODK_CONFIG_DIR": str(tmp_path), "HOME": "/unused", "USERPROFILE": "/unused"}) == tmp_path / "plugins.json"


def test_shared_file_projects_enable_values_without_standalone_bounds_or_metadata_authority(tmp_path):
    env = fixture_env(tmp_path)
    file = tmp_path / "plugins.json"
    content = '{"version":1,"plugins":{},"plugins":{"odk.futu.gateway":{"enabled":false,"metadata":"' + 'x' * 20000 + '"}}}'
    file.write_text(content)
    assert disabled(command(env)) == {"odk.futu.gateway"}
    assert file.read_text() == content


@pytest.mark.parametrize("version", ["1.0", "1e0"])
def test_shared_version_uses_shell_numeric_json_semantics(tmp_path, version):
    env = fixture_env(tmp_path)
    (tmp_path / "plugins.json").write_text('{"version":' + version + ',"plugins":{"odk.futu.gateway":{"enabled":false}}}')
    assert disabled(command(env)) == {"odk.futu.gateway"}


def test_common_file_uses_the_shell_utf8_encoding(tmp_path):
    env = fixture_env(tmp_path)
    (tmp_path / "plugins.json").write_bytes('{"version":1,"plugins":{"odk.futu.gateway":{"enabled":false}}}'.encode('utf-16'))
    result = command(env)
    assert disabled(result) == set()
    assert "plugin configuration unavailable" in result.stderr


def test_common_utf8_replacement_and_large_numeric_metadata_match_shell(tmp_path):
    env = fixture_env(tmp_path)
    file = tmp_path / "plugins.json"
    prefix = b'{"version":1,"plugins":{"odk.futu.gateway":{"enabled":false}},"metadata":'
    for metadata in [b'"\xff"', b'9' * 10000]:
        content = prefix + metadata + b'}'
        file.write_bytes(content)
        assert disabled(command(env)) == {"odk.futu.gateway"}
        assert file.read_bytes() == content


def test_actual_startup_does_not_import_a_shared_disabled_external_entry(tmp_path):
    env = fixture_env(tmp_path)
    env.update({"FUTU_PORT": "11111", "FUTU_TRADE_PWD": "", "FUTU_INTERVAL": "60", "ODK_FUTU_CONTROL": ""})
    (tmp_path / "plugins.json").write_text('{"version":1,"plugins":{"odk.futu.loop":{"enabled":false},"odk.futu.publisher":{"enabled":false}}}')
    package = tmp_path / "loop"
    package.mkdir()
    manifest = next(item["manifest"] for item in poller.create_poller({}).catalog() if item["manifest"]["id"] == "odk.futu.loop")
    (package / "manifest.json").write_text(json.dumps({**manifest, "version": "2.0.0", "entry": "entry.py"}))
    (package / "entry.py").write_text("raise RuntimeError('disabled external entry executed')")
    args = [sys.executable, poller.__file__, "--plugin-directory", str(package), "--trust-plugins"]
    for capability in manifest["permissions"]:
        args.extend(["--grant-plugin", manifest["id"] + ":" + capability])
    result = subprocess.run(args, env=env, capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert result.stderr == ""
