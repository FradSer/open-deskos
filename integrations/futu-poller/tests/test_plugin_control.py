"""The Python owner dispatches the common runtime management contract."""
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import poller
from plugin_control import dispatch_plugin_control
from plugin_host import PluginHost


def composition(failing=False):
    events = []
    class Publisher:
        def send(self, record):
            pass
        def close(self):
            events.append("close")
            if failing:
                raise RuntimeError("private cleanup error")
    runtime = poller.create_poller({}, publisher_factory=lambda context: Publisher())
    runtime.start()
    return runtime, events


def test_control_inventory_excludes_private_catalog_fields():
    runtime, events = composition()
    result = dispatch_plugin_control(runtime.host, {"command": "inventory"})
    assert result == {"ok": True, "scope": "python-agent", "plugins": [
        {"pluginId": entry["manifest"]["id"], "host": "python-agent"} for entry in runtime.catalog()]}
    assert events == []
    runtime.close()


def test_control_disable_enable_preserves_independent_resources_and_does_not_save_preferences(tmp_path, monkeypatch):
    config = tmp_path / "preferences.json"
    config.write_text('{"version":1,"plugins":{}}')
    monkeypatch.setenv("ODK_FUTU_PLUGIN_CONFIG", str(config))
    runtime, events = composition()
    gateway = runtime.host.get(poller.PORTS["gateway"])
    for command, enabled, state in [("disable", False, "disabled"), ("enable", True, "running")]:
        assert dispatch_plugin_control(runtime.host, {"command": command, "pluginId": "odk.futu.publisher"}) == {
            "ok": True, "scope": "python-agent", "pluginId": "odk.futu.publisher", "enabled": enabled, "state": state}
        assert runtime.host.get(poller.PORTS["gateway"]) is gateway
    assert events == ["close"]
    assert config.read_text() == '{"version":1,"plugins":{}}'
    runtime.close()


@pytest.mark.parametrize("command_request,error,options", [
    ({"command": "inventory", "pluginId": "odk.futu.publisher"}, "invalid-command", {}),
    ({"command": "disable", "pluginId": "odk.futu.publisher", "extra": True}, "invalid-command", {}),
    ({"command": "replace", "pluginId": "odk.futu.publisher"}, "invalid-command", {}),
    ([], "invalid-command", {}),
    ({"command": "disable", "pluginId": "odk.futu.unknown"}, "unknown-plugin", {}),
    ({"command": "disable", "pluginId": "odk.futu.ümlaut"}, "unknown-plugin", {}),
    ({"command": "disable", "pluginId": "odk.futu.publisher"}, "protected-plugin", {"protected_ids": ("odk.futu.publisher",)}),
    ({"command": "disable", "pluginId": "odk.futu.publisher"}, "runtime-stopped", {"stopped": True}),
    ({"command": "inventory"}, "runtime-stopped", {"stopped": True}),
])
def test_refused_commands_preserve_owned_state(command_request, error, options):
    runtime, events = composition()
    before = runtime.catalog()
    assert dispatch_plugin_control(runtime.host, command_request, **options) == {"ok": False, "error": error}
    assert runtime.catalog() == before
    assert events == []
    runtime.close()


def test_cleanup_failure_returns_bounded_receipt_and_retries_retained_resource():
    runtime, events = composition(failing=True)
    request = {"command": "disable", "pluginId": "odk.futu.publisher"}
    for count in (1, 2):
        assert dispatch_plugin_control(runtime.host, request) == {"ok": False, "error": "lifecycle-failed"}
        assert events == ["close"] * count
        assert runtime.catalog()[0]["state"] == "cleanup-failed"
    with pytest.raises(RuntimeError, match="private cleanup error"):
        runtime.close()


def test_dispatch_refuses_foreign_thread_before_any_owned_operation():
    runtime, events = composition()
    before = runtime.catalog()
    with ThreadPoolExecutor(max_workers=1) as pool:
        with pytest.raises(RuntimeError, match="owner thread"):
            pool.submit(dispatch_plugin_control, runtime.host, {"command": "disable", "pluginId": "odk.futu.publisher"}).result(timeout=5)
    assert runtime.catalog() == before
    assert events == []
    runtime.close()


@pytest.mark.parametrize("damage", ["empty", "count", "bytes"])
def test_invalid_inventory_returns_no_partial_or_private_content(damage):
    runtime, _ = composition()
    original = runtime.host._records
    if damage == "empty":
        runtime.host._records = {}
    elif damage == "count":
        record = next(iter(original.values()))
        runtime.host._records = {str(index): record for index in range(129)}
    else:
        next(iter(original.values())).manifest["id"] = "private" * 3000
    assert dispatch_plugin_control(runtime.host, {"command": "inventory"}) == {"ok": False, "error": "inventory-unavailable"}
    runtime.host._records = original
    runtime.close()


def test_enable_blocked_component_does_not_claim_running():
    runtime, _ = composition()
    dispatch_plugin_control(runtime.host, {"command": "disable", "pluginId": "odk.futu.publisher"})
    assert dispatch_plugin_control(runtime.host, {"command": "enable", "pluginId": "odk.futu.loop"}) == {
        "ok": False, "error": "lifecycle-failed"}
    assert next(entry for entry in runtime.catalog() if entry["manifest"]["id"] == "odk.futu.loop")["state"] == "blocked"
    runtime.close()


def test_oversized_command_refuses_before_mutation_or_echoing_identity():
    identity = "odk." + "a" * 20000
    host = PluginHost()
    events = []
    host.register({"manifest": {"schemaVersion": 1, "id": identity, "name": "fixture", "version": "1.0.0",
                               "host": "python-agent", "kind": "service", "provides": [], "requires": []},
                   "create": lambda context: {"stop": lambda: events.append("stop")}})
    host.start()
    before = host.catalog()
    assert dispatch_plugin_control(host, {"command": "disable", "pluginId": identity}) == {
        "ok": False, "error": "invalid-command"}
    assert host.catalog() == before
    assert events == []
    host.stop()


def test_python_receipts_match_actual_javascript_dispatcher():
    runtime, _ = composition()
    catalog = runtime.catalog()
    requests = [{"command": "inventory"}, {"command": "disable", "pluginId": "odk.futu.publisher"},
                {"command": "enable", "pluginId": "odk.futu.publisher"},
                {"command": "disable", "pluginId": "odk.futu.unknown"},
                {"command": "disable", "pluginId": "odk.futu.publisher", "extra": 1}]
    expected = [dispatch_plugin_control(runtime.host, request) for request in requests]
    source = Path(poller.__file__).resolve().parents[2] / "runtime/shell/src/plugin-control.js"
    script = """
const {createPluginControl}=require(process.argv[1]);
const {catalog,requests}=JSON.parse(require('node:fs').readFileSync(0,'utf8'));
const control=createPluginControl({scope:'python-agent',protectedIds:[],snapshot:()=>catalog,
  setEnabled:(id,enabled)=>{catalog.find(p=>p.manifest.id===id).state=enabled?'running':'disabled'}});
(async()=>{const results=[];for(const request of requests)results.push(await control.dispatch(request));
  process.stdout.write(JSON.stringify(results))})().catch(()=>process.exit(1));
"""
    result = subprocess.run(["node", "-e", script, str(source)], input=json.dumps({"catalog": catalog, "requests": requests}),
                            text=True, capture_output=True, check=True, timeout=10)
    assert json.loads(result.stdout) == expected
    runtime.close()
