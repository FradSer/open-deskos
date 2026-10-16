"""Read-only reports use the actual Python composition."""
import json
from pathlib import Path
import subprocess

import poller
import pytest


def test_diagnosis_tracks_real_lifecycle_without_provider_or_cleanup_work():
    events = []
    class Publisher:
        def send(self, _record): pass
        def close(self): events.append("close")
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "private-fixture-password"},
                                  publisher_factory=lambda ctx: Publisher(), disabled=("odk.futu.gateway",))
    report = runtime.diagnose()
    assert report["host"] == "python-agent"
    assert report["instance"] == "futu-poller"
    assert report["state"] == "available"
    assert all(item["state"] == "registered" for item in report["plugins"])
    runtime.start()
    report = runtime.diagnose()
    assert {item["manifest"]["id"]: item["state"] for item in report["plugins"]} == {
        "odk.futu.publisher": "running", "odk.futu.gateway": "disabled", "odk.futu.loop": "blocked", "odk.futu.transport": "running"}
    assert events == []
    assert all(item["health"] == {"state": "unknown", "reason": "not-declared"} for item in report["plugins"])
    assert "private-fixture-password" not in json.dumps(report)
    report["plugins"][0]["manifest"]["name"] = "changed by caller"
    assert runtime.catalog()[0]["manifest"]["name"] != "changed by caller"
    runtime.close()
    assert events == ["close"]
    assert runtime.diagnose()["plugins"][0]["state"] == "stopped"


def test_failed_runtime_report_excludes_errors_and_extra_manifest_fields():
    def fail(_context): raise RuntimeError("private-fixture-password /private/channel")
    runtime = poller.create_poller({}, publisher_factory=fail)
    record = next(iter(runtime.host._records.values()))
    record.manifest["entry"] = "/private/module.py"
    record.manifest["metadata"] = {"secret": "private-fixture-password"}
    runtime.host.start()
    report = runtime.diagnose()
    assert report["plugins"][0]["state"] == "failed"
    assert "private" not in json.dumps(report)
    assert "error" not in report["plugins"][0]
    runtime.close()


def test_python_report_passes_real_shell_validator():
    runtime = poller.create_poller({})
    report = runtime.diagnose()
    source = Path(poller.__file__).resolve().parents[2] / "runtime/shell/src/plugin-runtime-report.js"
    code = "const fs=require('node:fs'); const {sanitizeRuntimePlugins}=require(process.argv[1]); const report=JSON.parse(fs.readFileSync(0,'utf8')); console.log(JSON.stringify(sanitizeRuntimePlugins(report,'python-agent')));"
    result = subprocess.run(["node", "-e", code, str(source)], input=json.dumps(report),
                            capture_output=True, text=True, timeout=10, check=True)
    normalized = json.loads(result.stdout)
    assert len(normalized) == 4
    assert all(item["state"] == "registered" for item in normalized)


def test_oversized_public_report_is_unavailable_without_content():
    runtime = poller.create_poller({})
    next(iter(runtime.host._records.values())).manifest["name"] = "private-oversized" * 2000
    assert runtime.diagnose() == {"host": "python-agent", "instance": "futu-poller", "state": "unavailable",
                                 "reason": "report-invalid", "plugins": []}


def test_diagnosis_keeps_cleanup_failure_state_without_retrying_cleanup():
    calls = []
    class Publisher:
        def send(self, _record): pass
        def close(self):
            calls.append("close")
            raise RuntimeError("private cleanup failure")
    runtime = poller.create_poller({}, publisher_factory=lambda context: Publisher())
    runtime.start()
    with pytest.raises(RuntimeError, match="private cleanup failure"):
        runtime.close()
    report = runtime.diagnose()
    assert report["plugins"][0]["state"] == "cleanup-failed"
    assert calls == ["close"]
    assert "private" not in json.dumps(report)


def test_diagnosis_tracks_local_enable_changes_without_creating_resources():
    runtime = poller.create_poller({})
    runtime.set_enabled("odk.futu.gateway", False)
    gateway = next(item for item in runtime.diagnose()["plugins"] if item["manifest"]["id"] == "odk.futu.gateway")
    assert gateway["enabled"] is False
    runtime.set_enabled("odk.futu.gateway", True)
    gateway = next(item for item in runtime.diagnose()["plugins"] if item["manifest"]["id"] == "odk.futu.gateway")
    assert gateway["enabled"] is True
    assert gateway["state"] == "registered"


def test_oversized_public_value_is_rejected_before_copying_or_serializing(monkeypatch):
    import plugin_host
    runtime = poller.create_poller({})
    next(iter(runtime.host._records.values())).manifest["name"] = "x" * 16385
    def forbidden(*_args, **_kwargs): raise AssertionError("oversized metadata was copied or serialized")
    monkeypatch.setattr(plugin_host, "deepcopy", forbidden)
    monkeypatch.setattr(plugin_host.json, "dumps", forbidden)
    monkeypatch.setattr(plugin_host.json.JSONEncoder, "iterencode", forbidden)
    assert runtime.diagnose()["state"] == "unavailable"


def test_report_budget_counts_utf8_bytes_instead_of_characters():
    runtime = poller.create_poller({})
    next(iter(runtime.host._records.values())).manifest["name"] = "\U00010000" * 4096
    assert runtime.diagnose() == {"host": "python-agent", "instance": "futu-poller", "state": "unavailable",
                                 "reason": "report-invalid", "plugins": []}


def test_report_budget_counts_all_plugins_and_fields():
    runtime = poller.create_poller({})
    for record in runtime.host._records.values():
        record.manifest["name"] = "x" * 6000
    assert runtime.diagnose()["state"] == "unavailable"
    assert runtime.diagnose()["plugins"] == []


def test_report_rejects_excessive_plugin_count_before_encoding(monkeypatch):
    import plugin_host
    runtime = poller.create_poller({})
    record = next(iter(runtime.host._records.values()))
    runtime.host._records = {str(index): record for index in range(129)}
    def forbidden(*_args, **_kwargs): raise AssertionError("excessive catalog was serialized")
    monkeypatch.setattr(plugin_host.json.JSONEncoder, "iterencode", forbidden)
    assert runtime.diagnose()["state"] == "unavailable"
