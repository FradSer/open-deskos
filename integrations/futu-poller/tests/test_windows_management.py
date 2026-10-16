"""Controlled WinAPI completions prove state transitions, not Windows acceptance."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

import pytest
from management_channel import WindowsManagementChannel
import management_channel
import poller


class Operation:
    def __init__(self, data=b"", ready=False):
        self.data = data
        self.ready = ready
        self.event = id(self)
        self.aborted = False
        self.delay_cancel = False
        self.error = None
        self.cancel_error = None
    def GetOverlappedResult(self, wait):
        assert wait is False
        if self.error is not None:
            raise self.error
        return (len(self.data), 995 if self.aborted else 0) if self.ready else (0, 996)
    def getbuffer(self):
        assert self.ready
        return self.data
    def cancel(self):
        if self.cancel_error is not None:
            raise self.cancel_error
        if not self.delay_cancel:
            self.ready = self.aborted = True


class Api:
    PIPE_ACCESS_DUPLEX = 3
    FILE_FLAG_OVERLAPPED = 0x40000000
    FILE_FLAG_FIRST_PIPE_INSTANCE = 0x80000
    NULL = 0
    ERROR_IO_PENDING = 997
    def __init__(self):
        self.handles = {}
        self.operations = {}
        self.writes = []
        self.closed = []
        self.partial = False
    def CreateNamedPipe(self, endpoint, flags, mode, limit, out_size, in_size, timeout, security):
        assert endpoint.startswith("\\\\.\\pipe\\")
        assert flags & self.FILE_FLAG_OVERLAPPED
        assert mode & 8
        handle = len(self.handles) + len(self.closed) + 1
        self.handles[handle] = flags
        return handle
    def ConnectNamedPipe(self, handle, overlapped):
        assert overlapped
        operation = Operation()
        operation.kind = "connect"
        self.operations[handle] = operation
        return operation
    def ReadFile(self, handle, size, overlapped):
        assert overlapped and size <= 4097
        operation = Operation()
        operation.kind = "read"
        self.operations[handle] = operation
        return operation, 997
    def WriteFile(self, handle, payload, overlapped):
        assert overlapped
        size = 3 if self.partial and len(payload) > 3 else len(payload)
        self.writes.append(payload[:size])
        operation = Operation(payload[:size], True)
        self.operations[handle] = operation
        return operation, 0
    def CloseHandle(self, handle):
        assert handle in self.handles
        del self.handles[handle]
        self.closed.append(handle)
    def WaitForMultipleObjects(self, handles, wait_all, timeout):
        assert not wait_all and timeout >= 0
        return 258


def connected(channel, api):
    handle = next(handle for handle in api.handles if api.operations[handle].kind == "connect" and not api.operations[handle].ready)
    api.operations[handle].ready = True
    channel.poll(0)
    return handle


def feed(channel, api, handle, payload):
    operation = api.operations[handle]
    operation.data = payload
    operation.ready = True
    channel.poll(0)


def test_windows_authenticated_command_and_partial_response_run_on_owner():
    api = Api()
    api.partial = True
    calls = []
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: calls.append(request) or {"ok": True}, token="correct", api=api)
    channel.start()
    assert list(api.handles.values())[0] & api.FILE_FLAG_FIRST_PIPE_INSTANCE
    handle = connected(channel, api)
    feed(channel, api, handle, b'{"v":1,"token":"correct"}\n{"v":1,"id":"x","command":"inventory"}\n')
    for _ in range(30):
        channel.poll(0)
    assert json.loads(b"".join(api.writes)) == {"v": 1, "id": "x", "ok": True}
    assert len(calls) == 1
    assert handle in api.closed
    channel.close()
    assert not api.handles


@pytest.mark.parametrize("payload", [b'{"v":1,"id":"x","command":"inventory"}\n',
    b'{"v":1,"token":"wrong"}\n', b'x' * 513,
    b'{"v":1,"token":"correct"}\n' + b'x' * 4097])
def test_windows_refuses_unauthenticated_or_oversized_input(payload):
    api = Api()
    calls = []
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: calls.append(request) or {"ok": True}, token="correct", api=api)
    channel.start()
    handle = connected(channel, api)
    feed(channel, api, handle, payload)
    assert calls == []
    assert handle in api.closed
    channel.close()


def test_pending_cancellation_retains_handles_for_close_retry():
    api = Api()
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: {"ok": True}, token="correct", api=api)
    channel.start()
    operation = next(iter(api.operations.values()))
    operation.delay_cancel = True
    with pytest.raises(RuntimeError, match="pending"):
        channel.close()
    assert api.handles
    operation.delay_cancel = False
    channel.close()
    assert not api.handles


def test_terminal_broken_pipe_releases_handle_instead_of_retaining_slot():
    api = Api()
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: {"ok": True}, token="correct", api=api)
    channel.start()
    handle = connected(channel, api)
    error = OSError("broken pipe")
    error.winerror = 109
    api.operations[handle].error = error
    channel.poll(0)
    assert handle in api.closed
    channel.close()
    assert not api.handles


def test_failed_cancellation_retains_operation_for_explicit_retry():
    api = Api()
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: {"ok": True}, token="correct", api=api)
    channel.start()
    operation = next(iter(api.operations.values()))
    operation.cancel_error = OSError("cancel failed")
    with pytest.raises(OSError, match="cancel failed"):
        channel.close()
    assert api.handles
    operation.cancel_error = None
    channel.close()
    assert not api.handles


def test_idle_windows_peer_does_not_block_fragmented_authenticated_command():
    api = Api()
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: {"ok": True}, token="correct", api=api)
    channel.start()
    idle = connected(channel, api)
    active = connected(channel, api)
    feed(channel, api, active, b'{"v":1,"token":')
    feed(channel, api, active, b'"correct"}\n{"v":1,"id":"x",')
    feed(channel, api, active, b'"command":"inventory"}\n')
    channel.poll(0)
    assert json.loads(b"".join(api.writes))["ok"]
    assert idle not in api.closed
    channel.close()


def test_first_instance_conflict_never_closes_another_listener():
    class RefusedApi(Api):
        def CreateNamedPipe(self, endpoint, flags, *args):
            assert flags & self.FILE_FLAG_FIRST_PIPE_INSTANCE
            raise OSError("pipe already owned")
    api = RefusedApi()
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: {"ok": True}, token="correct", api=api)
    with pytest.raises(OSError, match="pipe already owned"):
        channel.start()
    channel.close()
    assert api.closed == []


def test_windows_foreign_thread_cannot_pump_or_close():
    api = Api()
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: {"ok": True}, token="correct", api=api)
    channel.start()
    with ThreadPoolExecutor(max_workers=1) as pool:
        for operation in (lambda: channel.poll(0), channel.close):
            with pytest.raises(RuntimeError, match="owner thread"):
                pool.submit(operation).result(timeout=5)
    assert api.handles
    channel.close()


def test_windows_refuses_missing_token_before_creating_handle():
    api = Api()
    channel = WindowsManagementChannel(r"\\.\pipe\fixture", lambda request: {"ok": True}, api=api)
    with pytest.raises(ValueError, match="token"):
        channel.start()
    assert not api.handles
    channel.close()


def test_windows_defaults_match_shell_identity_and_token_location():
    assert poller.management_settings({"LOCALAPPDATA": r"C:\Profile\AppData\Local"}, "win32") == (
        r"\\.\pipe\odk-futu-plugin-control", r"C:\Profile\AppData\Local\odk\local-channel.token")
    assert poller.management_settings({"ODK_FUTU_CONTROL": ""}, "win32")[0] is None


def test_windows_composition_selects_pipe_and_authenticates_before_lifecycle(tmp_path, monkeypatch):
    api = Api()
    token = tmp_path / "token"
    token.write_text("correct\n")
    channel_type = WindowsManagementChannel
    monkeypatch.setattr(management_channel, "WindowsManagementChannel", lambda *args, **options: channel_type(*args, **options, api=api))
    class Publisher:
        def send(self, record):
            pass
    runtime = poller.create_poller({"ODK_CHANNEL_TOKEN_FILE": str(token)}, platform="win32", publisher_factory=lambda context: Publisher())
    runtime.start()
    channel = runtime.host.get(poller.CONTROL_PORT)
    assert isinstance(channel, channel_type)
    handle = connected(channel, api)
    feed(channel, api, handle, b'{"v":1,"token":"correct"}\n{"v":1,"id":"x","command":"disable","pluginId":"odk.futu.publisher"}\n')
    channel.poll(0)
    assert json.loads(b"".join(api.writes))["state"] == "disabled"
    runtime.close()
    assert not api.handles


@pytest.mark.skipif(sys.platform != "win32", reason="requires native Windows named pipes")
def test_native_windows_pipe_with_actual_node_client(tmp_path):
    endpoint = r"\\.\pipe\odk-futu-test-" + uuid.uuid4().hex
    token = tmp_path / "token"
    token.write_text("controlled-token\n")
    calls = []
    channel = WindowsManagementChannel(endpoint, lambda request: calls.append(request) or {"ok": True, "scope": "python-agent"},
                                       token="controlled-token")
    channel.start()
    source = Path(poller.__file__).resolve().parents[2] / "runtime/shell/src/local-control-client.js"
    script = """
const {requestLocalControl}=require(process.argv[1]);
requestLocalControl({endpoint:process.argv[2],tokenFile:process.argv[3],platform:'win32',
  label:'native Python management',request:{command:'inventory'}})
  .then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stderr.write(error.message);process.exit(1)});
"""
    process = subprocess.Popen(["node", "-e", script, str(source), endpoint, str(token)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        deadline = time.monotonic() + 5
        while process.poll() is None and time.monotonic() < deadline:
            channel.poll(0.01)
        stdout, stderr = process.communicate(timeout=1)
        assert process.returncode == 0, stderr
        assert json.loads(stdout)["scope"] == "python-agent"
        assert len(calls) == 1
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()
        channel.close()


@pytest.mark.skipif(sys.platform != "win32", reason="requires native Windows named pipes")
def test_native_windows_management_preserves_composition_lifecycle(tmp_path):
    """Real pipe commands manage controlled resources on the composition owner."""
    prefix = r"\\.\pipe\odk-futu-lifecycle-" + uuid.uuid4().hex + "-"
    endpoint = prefix + "futu-plugin-control"
    token = tmp_path / "token"
    token.write_text("controlled-token\n")
    wrong_token = tmp_path / "wrong-token"
    wrong_token.write_text("incorrect-token\n")
    preferences = tmp_path / "preferences.json"
    preferences.write_text('{"version":1,"plugins":{}}')
    events = []

    class Publisher:
        def send(self, record):
            raise AssertionError("management must not publish readings")

        def close(self):
            events.append("publisher.close")

    runtime = poller.create_poller({
        "ODK_FUTU_CONTROL": endpoint, "ODK_CHANNEL_TOKEN_FILE": str(token),
        "ODK_FUTU_PLUGIN_CONFIG": str(preferences),
    }, platform="win32", publisher_factory=lambda context: Publisher())
    source = Path(poller.__file__).resolve().parents[2] / "runtime/shell/src/local-control-client.js"
    script = """
const {requestLocalControl}=require(process.argv[1]);
requestLocalControl({endpoint:process.argv[2],tokenFile:process.argv[3],platform:'win32',
  label:'native Python management',request:JSON.parse(process.argv[4])})
  .then(result=>process.stdout.write(JSON.stringify(result)))
  .catch(error=>{process.stderr.write(error.message);process.exit(1)});
"""
    cli = source.parents[1] / "scripts/odk-plugin-cli.js"
    preload = tmp_path / "isolated-host.cjs"
    # Keep native Windows host resolution; isolate every discovery endpoint.
    preload.write_text("""
const platform = require(%s);
const resolve = platform.resolveShellHost;
platform.resolveShellHost = options => {
  const host = resolve(options);
  if (host.platform !== 'win32') throw Error('native Windows host required');
  return {...host, localChannelTokenFile:process.env.ODK_TEST_TOKEN,
    endpoint:name => process.env.ODK_TEST_PIPE_PREFIX + name};
};
""" % json.dumps(str(source.parent / "platform")))
    runtime.start()
    channel = runtime.host.get(poller.CONTROL_PORT)
    gateway = runtime.host.get(poller.PORTS["gateway"])
    original = runtime.host.get(poller.PORTS["publisher"])
    original_loop = runtime.host.get(poller.PORTS["loop"])

    def request(command, identity=None, token_file=token, use_cli=False):
        payload = {"command": command}
        if identity is not None:
            payload["pluginId"] = identity
        args = (["node", "--require", str(preload), str(cli), command, identity, "--runtime"]
                if use_cli else ["node", "-e", script, str(source), endpoint,
                                 str(token_file), json.dumps(payload)])
        env = {**os.environ, "ODK_TEST_TOKEN": str(token_file), "ODK_TEST_PIPE_PREFIX": prefix,
               "ODK_CONFIG_DIR": str(tmp_path / "cli-preferences")}
        process = subprocess.Popen(args, env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            deadline = time.monotonic() + 5
            while process.poll() is None and time.monotonic() < deadline:
                channel.poll(0.01)
            stdout, stderr = process.communicate(timeout=1)
            return process.returncode, json.loads(stdout) if stdout else None, stderr
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    try:
        code, inventory, stderr = request("inventory")
        assert code == 0, stderr
        assert inventory["scope"] == "python-agent"
        assert {item["pluginId"] for item in inventory["plugins"]} == {
            "odk.futu.control", "odk.futu.publisher", "odk.futu.gateway",
            "odk.futu.loop", "odk.futu.transport",
        }
        code, result, _ = request("disable", "odk.futu.publisher", wrong_token, use_cli=True)
        assert code != 0 and result is None
        assert runtime.host.get(poller.PORTS["publisher"]) is original
        assert events == []
        for command, state in [("disable", "disabled"), ("enable", "running")]:
            code, result, stderr = request(command, "odk.futu.publisher", use_cli=True)
            assert code == 0, stderr
            assert result["state"] == state
            assert runtime.host.get(poller.CONTROL_PORT) is channel
            assert runtime.host.get(poller.PORTS["gateway"]) is gateway
            assert next(item for item in runtime.catalog()
                        if item["manifest"]["id"] == "odk.futu.loop")["state"] == ("blocked" if command == "disable" else "running")
        assert runtime.host.get(poller.PORTS["publisher"]) is not original
        assert runtime.host.get(poller.PORTS["loop"]) is not original_loop
        assert events == ["publisher.close"]
        code, result, stderr = request("disable", "odk.futu.control", use_cli=True)
        assert code != 0 and result is None
        assert "protected-plugin" in stderr
        assert runtime.host.get(poller.CONTROL_PORT) is channel
        assert request("inventory")[0] == 0
        assert not (tmp_path / "cli-preferences" / "plugins.json").exists()
        assert preferences.read_text() == '{"version":1,"plugins":{}}'
    finally:
        runtime.close()
    assert events == ["publisher.close", "publisher.close"]
    assert not channel._states
