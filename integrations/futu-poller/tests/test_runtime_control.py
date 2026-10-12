"""Actual operational entry keeps an independent owner-thread management path."""
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import pytest

import poller
from plugin_control import dispatch_plugin_control


@pytest.mark.parametrize("unavailable", ["occupied", "public-directory"])
def test_failed_management_startup_preserves_independent_polling(tmp_path, unavailable):
    directory = tmp_path / "open-deskos-futu"
    directory.mkdir(mode=0o700)
    endpoint = directory / "control.sock"
    if unavailable == "occupied":
        endpoint.write_text("preserved")
    else:
        directory.chmod(0o755)
    records = []
    events = []
    class Publisher:
        def send(self, record):
            records.append(record)
        def close(self):
            events.append("close")
    def wait(seconds):
        assert seconds == 23
        report = runtime.diagnose()
        control = next(entry for entry in report["plugins"] if entry["manifest"]["id"] == "odk.futu.control")
        assert control["state"] == "failed"
        assert all(entry["state"] == "running" for entry in runtime.catalog() if entry["manifest"]["id"] != "odk.futu.control")
        raise KeyboardInterrupt
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path), "FUTU_INTERVAL": "23"},
                                  publisher_factory=lambda context: Publisher(), wait=wait)
    runtime.run()
    assert records == [{"type": "auth-required", "secrets": ["futu-trade-password"]}]
    assert events == ["close"]
    if unavailable == "occupied":
        assert endpoint.read_text() == "preserved"
    else:
        assert directory.stat().st_mode & 0o777 == 0o755


def test_feature_error_is_not_hidden_by_unavailable_management(tmp_path):
    directory = tmp_path / "open-deskos-futu"
    directory.mkdir(mode=0o700)
    endpoint = directory / "control.sock"
    endpoint.write_text("preserved")
    failure = RuntimeError("feature startup failure")
    def fail(context):
        raise failure
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path)}, publisher_factory=fail)
    with pytest.raises(RuntimeError) as caught:
        runtime.start()
    assert caught.value is failure
    runtime.close()
    assert endpoint.read_text() == "preserved"


def test_loop_error_retains_manager_for_explicit_retry(tmp_path, monkeypatch):
    events = []
    class Publisher:
        def send(self, record):
            pass
    class Loop:
        def __init__(self):
            events.append("create")
        def run(self):
            events.append("run")
            if events.count("run") == 1:
                raise RuntimeError("private loop error")
            raise KeyboardInterrupt
        def close(self):
            events.append("close")
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path)}, publisher_factory=lambda context: Publisher(),
                                  loop_factory=lambda context: Loop())
    runtime.start()
    control = runtime.host.get(poller.CONTROL_PORT)
    publisher = runtime.host.get(poller.PORTS["publisher"])
    def pump(seconds):
        assert next(entry for entry in runtime.catalog() if entry["manifest"]["id"] == "odk.futu.loop")["state"] == "failed"
        assert runtime.host.get(poller.CONTROL_PORT) is control
        assert runtime.host.get(poller.PORTS["publisher"]) is publisher
        assert events == ["create", "run", "close"]
        assert dispatch_plugin_control(runtime.host, {"command": "enable", "pluginId": "odk.futu.loop"})["ok"]
    monkeypatch.setattr(control, "poll", pump)
    runtime.run()
    assert events == ["create", "run", "close", "create", "run", "close"]


def test_unmanaged_loop_error_keeps_original_exit_and_cleanup():
    events = []
    class Publisher:
        def send(self, record):
            pass
    class Loop:
        def run(self):
            raise RuntimeError("loop error")
        def close(self):
            events.append("close")
    runtime = poller.create_poller({}, publisher_factory=lambda context: Publisher(), loop_factory=lambda context: Loop())
    with pytest.raises(RuntimeError, match="loop error"):
        runtime.run()
    assert events == ["close"]


@pytest.mark.parametrize("reuse_instance", [False, True])
def test_retired_loop_error_cannot_fail_new_generation(tmp_path, monkeypatch, reuse_instance):
    events = []
    class Publisher:
        def send(self, record):
            pass
    class Loop:
        def run(self):
            events.append("run")
            if events.count("run") == 1:
                for command in ("disable", "enable"):
                    assert dispatch_plugin_control(runtime.host, {"command": command, "pluginId": "odk.futu.loop"})["ok"]
                raise RuntimeError("retired generation error")
            assert next(entry for entry in runtime.catalog() if entry["manifest"]["id"] == "odk.futu.loop")["state"] == "running"
            raise KeyboardInterrupt
        def close(self):
            events.append("close")
    singleton = Loop()
    def create(context):
        events.append("create")
        return singleton if reuse_instance else Loop()
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path)}, publisher_factory=lambda context: Publisher(),
                                  loop_factory=create)
    runtime.start()
    def unexpected_poll(seconds):
        raise AssertionError("old error retired the replacement activation")
    monkeypatch.setattr(runtime.host.get(poller.CONTROL_PORT), "poll", unexpected_poll)
    runtime.run()
    assert events == ["create", "run", "close", "create", "run", "close"]


def test_wait_stops_when_reused_loop_gets_a_new_activation(tmp_path, monkeypatch):
    waits = []
    callbacks = []
    class Publisher:
        def send(self, record):
            pass
    class Loop:
        def run(self):
            pass
    loop = Loop()
    def create(context):
        callbacks.append(context.capability("poll.wait"))
        return loop
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path)}, publisher_factory=lambda context: Publisher(),
                                  loop_factory=create, wait=lambda seconds: waits.append(seconds))
    runtime.start()
    control = runtime.host.get(poller.CONTROL_PORT)
    def poll(seconds):
        for command in ("disable", "enable"):
            assert dispatch_plugin_control(runtime.host, {"command": command, "pluginId": "odk.futu.loop"})["ok"]
    monkeypatch.setattr(control, "poll", poll)
    try:
        callbacks[0](23)
        assert waits == []
    finally:
        runtime.close()


def test_actual_external_loop_fault_recovers_through_cli(tmp_path):
    root = Path(poller.__file__).resolve().parents[2]
    cli = root / "runtime/shell/scripts/open-deskos-plugin-cli.js"
    directory = tmp_path / "replacement"
    directory.mkdir()
    manifest = next(entry["manifest"] for entry in poller.create_poller({}).catalog() if entry["manifest"]["id"] == "odk.futu.loop")
    manifest.update({"entry": "entry.py", "version": "2.0.0"})
    (directory / "manifest.json").write_text(json.dumps(manifest))
    (directory / "entry.py").write_text('''
import json
from pathlib import Path
marker = Path(__file__).with_name("attempted")
class Loop:
    def run(self):
        if not marker.exists():
            marker.write_text("attempted")
            print(json.dumps({"fixture": "failed"}), flush=True)
            raise RuntimeError("private replacement execution error")
        print(json.dumps({"fixture": "resumed"}), flush=True)
    def close(self):
        print(json.dumps({"fixture": "released"}), flush=True)
def create(context):
    return Loop()
''')
    env = {**os.environ, "XDG_RUNTIME_DIR": str(tmp_path), "XDG_STATE_HOME": str(tmp_path),
           "OPEN_DESKOS_CONFIG_DIR": str(tmp_path / "config"), "FUTU_TRADE_PWD": "",
           "ODESK_FUTU_TARGETS_FILE": str(tmp_path / "absent.json")}
    env.pop("ODESK_FUTU_SOCKET", None)
    args = [sys.executable, poller.__file__, "--plugin-directory", str(directory), "--trust-plugins"]
    for capability in manifest["permissions"]:
        args += ["--grant-plugin", "odk.futu.loop:" + capability]
    process = subprocess.Popen(args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
    def event():
        assert select.select([process.stdout], [], [], 5)[0], "missing replacement event"
        return json.loads(process.stdout.readline())["fixture"]
    try:
        assert event() == "failed"
        assert event() == "released"
        assert process.poll() is None
        result = subprocess.run(["node", str(cli), "enable", "odk.futu.loop", "--runtime"],
                                env=env, text=True, capture_output=True, timeout=5)
        assert result.returncode == 0, result.stderr
        assert json.loads(result.stdout)["state"] == "running"
        assert event() == "resumed"
        assert process.poll() is None
        assert not (tmp_path / "config/plugins.json").exists()
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
        try:
            _, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise
    assert process.returncode == 0, stderr.decode()
    assert not (tmp_path / "open-deskos-futu/control.sock").exists()


def test_operational_cli_disables_and_recovers_polling_without_preferences(tmp_path):
    root = Path(poller.__file__).resolve().parents[2]
    cli = root / "runtime/shell/scripts/open-deskos-plugin-cli.js"
    env = {**os.environ, "XDG_RUNTIME_DIR": str(tmp_path), "XDG_STATE_HOME": str(tmp_path),
           "OPEN_DESKOS_CONFIG_DIR": str(tmp_path / "config"), "FUTU_INTERVAL": "60",
           "FUTU_TRADE_PWD": "", "ODESK_FUTU_TARGETS_FILE": str(tmp_path / "no-targets.json")}
    env.pop("ODESK_FUTU_SOCKET", None)
    process = subprocess.Popen([sys.executable, poller.__file__], env=env, text=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    def publication():
        assert select.select([process.stdout], [], [], 5)[0], "poller did not publish"
        return json.loads(process.stdout.readline())
    def command(action, name):
        result = subprocess.run(["node", str(cli), action, "odk.futu." + name, "--runtime"],
                                env=env, text=True, capture_output=True, timeout=5)
        return result
    try:
        assert publication() == {"v": 1, "service": "futu-poller", "type": "auth-required", "secrets": ["futu-trade-password"]}
        endpoint = tmp_path / "open-deskos-futu/control.sock"
        assert endpoint.exists()
        for name in ("publisher", "loop", "gateway", "transport"):
            result = command("disable", name)
            assert result.returncode == 0, result.stderr
            assert json.loads(result.stdout)["state"] == "disabled"
            assert process.poll() is None
            result = command("enable", name)
            assert result.returncode == 0, result.stderr
            assert json.loads(result.stdout)["state"] == "running"
            assert publication()["type"] == "auth-required"
        result = command("disable", "control")
        assert result.returncode == 1
        assert "protected-plugin" in result.stderr
        assert not (tmp_path / "config/plugins.json").exists()
    finally:
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
        try:
            _, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.communicate()
            raise
    assert process.returncode == 0, stderr
    assert not endpoint.exists()


def test_failed_provider_startup_retains_started_management(tmp_path):
    events = []
    def fail(context):
        events.append("attempt")
        raise RuntimeError("private provider failure")
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path)}, publisher_factory=fail)
    try:
        runtime.start()
        assert runtime.host.get("odk:futu/control/v1") is not None
        assert next(item for item in runtime.catalog() if item["manifest"]["id"] == "odk.futu.publisher")["state"] == "failed"
        assert events == ["attempt"]
    finally:
        runtime.close()


def test_managed_loop_switches_generation_before_reusing_closed_publisher(tmp_path):
    publishers = []
    waits = []
    class Publisher:
        def __init__(self):
            self.closed = False
            self.records = []
            publishers.append(self)
        def send(self, record):
            assert not self.closed, "released publisher used by old loop"
            self.records.append(record)
        def close(self):
            assert not self.closed
            self.closed = True
    def wait(seconds):
        waits.append(seconds)
        if len(waits) == 1:
            for command in ("disable", "enable"):
                assert dispatch_plugin_control(runtime.host, {"command": command, "pluginId": "odk.futu.publisher"})["ok"]
        else:
            raise KeyboardInterrupt
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path), "FUTU_INTERVAL": "23"},
                                  publisher_factory=lambda context: Publisher(), wait=wait)
    runtime.run()
    assert waits == [23, 23]
    assert len(publishers) == 2
    assert all(publisher.closed and len(publisher.records) == 1 for publisher in publishers)
    assert not (tmp_path / "open-deskos-futu/control.sock").exists()


def test_manager_reads_do_not_restart_publication_deadline(tmp_path, monkeypatch):
    now = [100.0]
    waits = []
    requests = []
    monkeypatch.setattr(poller.time, "monotonic", lambda: now[0])
    def wait(self, seconds):
        waits.append(seconds)
        now[0] += seconds
    monkeypatch.setattr(poller.LinkSet, "wait", wait)
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path), "ODESK_FUTU_TARGETS_FILE": str(tmp_path / "absent.json")})
    runtime.start()
    control = runtime.host.get(poller.CONTROL_PORT)
    def poll(seconds=0):
        requests.append(dispatch_plugin_control(runtime.host, {"command": "inventory"}))
    monkeypatch.setattr(control, "poll", poll)
    try:
        runtime.host.get(poller.PORTS["loop"]).wait(1)
        assert abs(sum(waits) - 1) < 1e-9
        assert len(requests) > 1
        assert all(result["ok"] for result in requests)
    finally:
        runtime.close()


def test_failed_provider_can_recover_without_restarting_control(tmp_path):
    failing = [True]
    class Publisher:
        def send(self, record):
            pass
    def create(context):
        if failing[0]:
            raise RuntimeError("private startup failure")
        return Publisher()
    runtime = poller.create_poller({"XDG_RUNTIME_DIR": str(tmp_path)}, publisher_factory=create)
    runtime.start()
    control = runtime.host.get(poller.CONTROL_PORT)
    try:
        failing[0] = False
        assert dispatch_plugin_control(runtime.host, {"command": "enable", "pluginId": "odk.futu.publisher"})["state"] == "running"
        assert runtime.host.get(poller.CONTROL_PORT) is control
        assert all(entry["state"] == "running" for entry in runtime.catalog())
    finally:
        runtime.close()
