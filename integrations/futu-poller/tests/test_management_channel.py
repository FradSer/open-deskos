"""Management transport pumps commands on the constructing owner thread."""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from management_channel import ManagementChannel
from plugin_control import dispatch_plugin_control
import poller
import management_channel


def exchange(channel, endpoint, payload):
    peer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    peer.settimeout(2)
    peer.connect(str(endpoint))
    peer.sendall(payload)
    for _ in range(3):
        channel.poll(0.01)
    try:
        result = peer.recv(65536)
    except ConnectionResetError:
        result = b""
    peer.close()
    return result


def test_channel_correlates_commands_on_owner_and_releases_endpoint(tmp_path):
    directory = tmp_path / "private"
    endpoint = directory / "control.sock"
    calls = []
    channel = ManagementChannel(str(endpoint), lambda request: calls.append(request) or {"ok": True, "scope": "python-agent", "plugins": []})
    channel.start()
    assert directory.stat().st_mode & 0o777 == 0o700
    request = {"v": 1, "id": "fixture.1", "command": "inventory"}
    assert json.loads(exchange(channel, endpoint, (json.dumps(request) + "\n").encode())) == {
        "v": 1, "id": "fixture.1", "ok": True, "scope": "python-agent", "plugins": []}
    assert calls == [request]
    channel.close()
    channel.close()
    assert not endpoint.exists()


@pytest.mark.parametrize("payload", [
    b'{"v":1,"token":"wrong"}\n{"v":1,"id":"x","command":"disable"}\n',
    b'{"v":true,"id":"x","command":"inventory"}\n',
    b'{"v":1,"id":"","command":"inventory"}\n',
    b'x' * 4097 + b'\n',
    b'{"v":1,"id":"x","command":"inventory"}\n{}\n',
])
def test_invalid_token_or_envelope_never_dispatches(tmp_path, payload):
    endpoint = tmp_path / "private" / "control.sock"
    calls = []
    channel = ManagementChannel(str(endpoint), lambda request: calls.append(request) or {"ok": True}, token="correct", require_token=True)
    channel.start()
    if b'"token"' not in payload:
        payload = b'{"v":1,"token":"correct"}\n' + payload
    assert exchange(channel, endpoint, payload) == b""
    assert calls == []
    channel.close()


def test_token_handshake_and_command_can_share_one_write(tmp_path):
    endpoint = tmp_path / "private" / "control.sock"
    channel = ManagementChannel(str(endpoint), lambda request: {"ok": True}, token="correct", require_token=True)
    channel.start()
    packet = b'{"v":1,"token":"correct"}\n{"v":1,"id":"x","command":"inventory"}\n'
    assert json.loads(exchange(channel, endpoint, packet)) == {"v": 1, "id": "x", "ok": True}
    channel.close()


def test_idle_peer_does_not_block_authenticated_peer(tmp_path):
    endpoint = tmp_path / "private" / "control.sock"
    channel = ManagementChannel(str(endpoint), lambda request: {"ok": True})
    channel.start()
    idle = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    idle.connect(str(endpoint))
    channel.poll(0)
    assert json.loads(exchange(channel, endpoint, b'{"v":1,"id":"x","command":"inventory"}\n'))["ok"]
    channel.close()
    idle.close()


def test_foreign_thread_cannot_pump_or_close_channel(tmp_path):
    endpoint = tmp_path / "private" / "control.sock"
    channel = ManagementChannel(str(endpoint), lambda request: {"ok": True})
    channel.start()
    with ThreadPoolExecutor(max_workers=1) as pool:
        for operation in (lambda: channel.poll(0), channel.close):
            with pytest.raises(RuntimeError, match="owner thread"):
                pool.submit(operation).result(timeout=5)
    assert endpoint.exists()
    channel.close()


def test_channel_refuses_existing_endpoint_without_removing_it(tmp_path):
    directory = tmp_path / "private"
    directory.mkdir(mode=0o700)
    endpoint = directory / "control.sock"
    endpoint.write_text("preserved")
    channel = ManagementChannel(str(endpoint), lambda request: {"ok": True})
    with pytest.raises(OSError):
        channel.start()
    channel.close()
    assert endpoint.read_text() == "preserved"


def test_failed_start_after_bind_releases_owned_path(tmp_path, monkeypatch):
    endpoint = tmp_path / "private" / "control.sock"
    class FailedListener(socket.socket):
        def listen(self, backlog):
            raise OSError("fixture listen failure")
    monkeypatch.setattr(socket, "socket", FailedListener)
    channel = ManagementChannel(str(endpoint), lambda request: {"ok": True})
    with pytest.raises(OSError, match="fixture listen failure"):
        channel.start()
    assert not endpoint.exists()
    channel.close()


def test_dispatch_duration_does_not_expire_successful_response(tmp_path, monkeypatch):
    endpoint = tmp_path / "private" / "control.sock"
    now = [100.0]
    calls = []
    monkeypatch.setattr(management_channel.time, "monotonic", lambda: now[0])
    def dispatch(request):
        calls.append(request)
        now[0] += 1.1
        return {"ok": True}
    channel = ManagementChannel(str(endpoint), dispatch)
    channel.start()
    assert json.loads(exchange(channel, endpoint, b'{"v":1,"id":"x","command":"disable"}\n'))["ok"]
    assert len(calls) == 1
    channel.close()


def test_channel_recovers_only_dead_owned_socket(tmp_path):
    directory = tmp_path / "private"
    directory.mkdir(mode=0o700)
    endpoint = directory / "control.sock"
    stale = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    stale.bind(str(endpoint))
    stale.close()
    channel = ManagementChannel(str(endpoint), lambda request: {"ok": True})
    channel.start()
    assert json.loads(exchange(channel, endpoint, b'{"v":1,"id":"x","command":"inventory"}\n'))["ok"]
    channel.close()


def test_channel_preserves_live_listener(tmp_path):
    directory = tmp_path / "private"
    directory.mkdir(mode=0o700)
    endpoint = directory / "control.sock"
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(endpoint))
    listener.listen(1)
    before = endpoint.lstat().st_ino
    channel = ManagementChannel(str(endpoint), lambda request: {"ok": True})
    try:
        with pytest.raises(OSError):
            channel.start()
        channel.close()
        assert endpoint.lstat().st_ino == before
    finally:
        listener.close()
        endpoint.unlink()


def test_actual_cli_changes_owned_python_resources_without_saved_preferences(tmp_path):
    endpoint = tmp_path / "odk-futu" / "control.sock"
    events = []
    class Publisher:
        def send(self, record):
            pass
        def close(self):
            events.append("close")
    runtime = poller.create_poller({}, publisher_factory=lambda context: Publisher())
    runtime.start()
    channel = ManagementChannel(str(endpoint), lambda request: dispatch_plugin_control(runtime.host, request))
    channel.start()
    root = Path(poller.__file__).resolve().parents[2]
    cli = root / "runtime/shell/scripts/odk-plugin-cli.js"
    env = {**os.environ, "XDG_RUNTIME_DIR": str(tmp_path), "XDG_STATE_HOME": str(tmp_path),
           "ODK_CONFIG_DIR": str(tmp_path / "config")}
    try:
        for command, state in [("disable", "disabled"), ("enable", "running")]:
            process = subprocess.Popen(["node", str(cli), command, "odk.futu.publisher", "--runtime"],
                                       env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                deadline = time.monotonic() + 5
                while process.poll() is None and time.monotonic() < deadline:
                    channel.poll(0.02)
                stdout, stderr = process.communicate(timeout=1)
                assert process.returncode == 0, stderr
                result = json.loads(stdout)
                assert result["scope"] == "python-agent"
                assert result["state"] == state
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()
        assert events == ["close"]
        assert not (tmp_path / "config/plugins.json").exists()
    finally:
        channel.close()
        runtime.close()
