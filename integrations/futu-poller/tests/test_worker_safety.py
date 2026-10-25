"""Worker packaging and supervisor boundaries without SDK or provider access."""
import io
import os
from pathlib import Path
import signal
import subprocess
import sys

import pytest
import poller


def test_missing_targets_refuse_private_stdout_and_gateway(tmp_path, capsys):
    opened = []
    runtime = poller.create_poller({"ODK_FUTU_CONTROL": "", "ODK_FUTU_TARGETS_FILE": str(tmp_path / "absent.json"), "FUTU_TRADE_PWD": "private-password"},
                                  gateway_factory=lambda context: opened.append("gateway"))
    with pytest.raises(ValueError, match="No valid desk targets"):
        runtime.run()
    assert opened == []
    assert capsys.readouterr().out == ""


def test_default_linkset_refuses_stdout_fallback(capsys):
    with pytest.raises(ValueError, match="No valid desk targets"):
        poller.LinkSet([], "fixture").send({"type": "data", "snapshot": {"private": "holdings"}})
    assert capsys.readouterr().out == ""


@pytest.mark.skipif(os.name == "nt", reason="POSIX permissions and signals")
@pytest.mark.parametrize("kind", ["public", "symlink", "hardlink", "large", "fifo", "control", "empty"])
def test_unsafe_token_files_are_refused(tmp_path, kind):
    token = tmp_path / "token"
    token.write_text("private-token\n")
    token.chmod(0o600)
    if kind == "public": token.chmod(0o644)
    elif kind == "symlink":
        token.rename(tmp_path / "actual")
        token.symlink_to(tmp_path / "actual")
    elif kind == "hardlink": os.link(token, tmp_path / "copy")
    elif kind == "large": token.write_text("x" * 1025)
    elif kind == "fifo":
        token.unlink()
        os.mkfifo(token, 0o600)
    elif kind == "control": token.write_text("private\nsecret")
    elif kind == "empty": token.write_text(" \n")
    with pytest.raises((ValueError, OSError)) as caught:
        poller.read_token_file(str(token))
    assert "private-token" not in str(caught.value)


def test_private_token_is_trimmed_and_bounded(tmp_path):
    token = tmp_path / "token"
    token.write_text("fixture-secret\n")
    token.chmod(0o600)
    assert poller.read_token_file(str(token)) == "fixture-secret"


def test_source_package_contains_only_hashed_runtime_whitelist(tmp_path):
    from build_package import build_package, RUNTIME_FILES
    import hashlib
    import json
    source = tmp_path / "source"
    source.mkdir()
    for name in RUNTIME_FILES:
        (source / name).write_text("runtime fixture")
    (source / "private.env").write_text("secret")
    destination = tmp_path / "package"
    manifest = build_package(destination, source=source)
    assert sorted(file.name for file in destination.iterdir()) == sorted([*RUNTIME_FILES, "service.json"])
    assert json.loads((destination / "service.json").read_text()) == manifest
    for item in manifest["files"]:
        assert item["sha256"] == hashlib.sha256((destination / item["path"]).read_bytes()).hexdigest()
    with pytest.raises(ValueError): build_package(destination, source=source)
    with pytest.raises(ValueError): build_package(tmp_path / "mutable", backend="docker", image="image:latest", source=source)
    docker = build_package(tmp_path / "docker", backend="docker", image="sha256:" + "a" * 64, source=source)
    assert docker["runtime"]["platform"] == "linux/arm64"
    assert docker["health"]["argv"] == ["python", "/app/healthcheck.py"]


@pytest.mark.skipif(os.name == "nt", reason="External service manager requires POSIX")
@pytest.mark.parametrize("ready_after, admitted", [(13, True), (61, False)])
def test_packaged_worker_admission_waits_for_owner_and_remains_bounded(tmp_path, monkeypatch, ready_after, admitted):
    from build_package import build_package
    from types import SimpleNamespace
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[2] / "service-runtime"))
    from odk_service_runtime import manager

    clock = [0.0]
    monkeypatch.setattr(manager, "time", SimpleNamespace(monotonic=lambda: clock[0], sleep=lambda seconds: clock.__setitem__(0, clock[0] + seconds)))

    def health(argv, **kwargs):
        assert argv[1] == "healthcheck.py"
        if clock[0] < ready_after:
            raise subprocess.CalledProcessError(1, argv)
        return subprocess.CompletedProcess(argv, 0)

    monkeypatch.setattr(manager, "subprocess", SimpleNamespace(run=health, DEVNULL=subprocess.DEVNULL))

    class Controller:
        running = False
        def reserve(self, service_id, revision, manifest, config, state_directory):
            return {"id": service_id, "revision": revision, "backend": "python"}
        def start(self, *args, handle=None):
            self.running = True
            return handle
        def status(self, handle):
            return {"state": "running" if self.running else "exited"}
        def remove(self, handle):
            self.running = False

    controller = Controller()
    backend = SimpleNamespace(prepare=lambda *_: None, command=lambda *_: [sys.executable])
    runtime = manager.ServiceRuntime(tmp_path.resolve() / "state", python_backend=backend, controller=controller)
    package = tmp_path.resolve() / "worker"
    build_package(package)
    runtime.install(package, {}, trusted=True)
    if admitted:
        assert runtime.enable("odk.futu.poller")["state"] == "running"
        assert controller.running and ready_after <= clock[0] < 60
    else:
        with pytest.raises(RuntimeError):
            runtime.enable("odk.futu.poller")
        assert not controller.running
        assert clock[0] == 60
        assert runtime.inspect("odk.futu.poller")["state"] == "disabled"


@pytest.mark.parametrize("malformed", [False, True])
def test_health_checks_running_control_inventory_without_provider(tmp_path, malformed):
    import json
    import socket
    import threading
    from healthcheck import check_health
    path = str(tmp_path / "health.sock")
    # Short socket paths are required on macOS.
    import tempfile
    with tempfile.TemporaryDirectory(prefix="odk-h-", dir="/tmp") as directory:
        path = directory + "/control.sock"
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
            server.bind(path)
            server.listen()
            def respond():
                with server.accept()[0] as peer:
                    packet = peer.recv(4096)
                    request = json.loads(packet)
                    reply = [] if malformed else {"v": 1, "id": request["id"], "ok": True, "scope": "python-agent",
                                                  "plugins": [{"pluginId": "odk.futu.control", "host": "python-agent"}]}
                    peer.sendall(json.dumps(reply).encode() + b"\n")
            thread = threading.Thread(target=respond)
            thread.start()
            try:
                assert check_health({"ODK_FUTU_CONTROL": path}) is (not malformed)
            finally:
                thread.join(timeout=3)
            assert not thread.is_alive()
    assert check_health({"ODK_FUTU_CONTROL": ""}) is False


@pytest.mark.parametrize("failed", [False, True])
def test_stop_during_sdk_call_skips_late_publication_and_wait(failed):
    records = []
    waits = []
    closed = []
    class Publisher:
        def send(self, record): records.append(record)
        def close(self): closed.append("publisher")
    class Gateway:
        def snapshot(self):
            runtime.stop_event.set()
            if failed:
                raise RuntimeError("fixture SDK failure after stop")
            return {"positions": []}
        def close(self): closed.append("gateway")
    runtime = poller.create_poller({"ODK_FUTU_CONTROL": "", "FUTU_TRADE_PWD": "fixture"},
                                  publisher_factory=lambda context: Publisher(), gateway_factory=lambda context: Gateway(),
                                  wait=lambda seconds: waits.append(seconds))
    runtime.run()
    assert records == []
    assert waits == []
    assert closed == ["gateway", "publisher"]
    assert all(entry["state"] == "stopped" for entry in runtime.catalog())


@pytest.mark.skipif(os.name == "nt", reason="POSIX supervisor signals")
@pytest.mark.parametrize("signum", [signal.SIGTERM, signal.SIGINT])
def test_supervisor_signal_closes_resources_on_owner_thread(tmp_path, signum):
    code = '''
import os, signal
import poller
events = []
class Publisher:
    def send(self, record): events.append('send')
    def close(self): events.append('closed')
def wait(seconds):
    os.kill(os.getpid(), int(os.environ['FIXTURE_SIGNAL']))
runtime = poller.create_poller({'ODK_FUTU_CONTROL': ''}, publisher_factory=lambda context: Publisher(), wait=wait)
poller.run_supervised(runtime)
assert events == ['send', 'closed'], events
assert all(entry['state'] == 'stopped' for entry in runtime.catalog())
'''
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(poller.__file__).parent,
                            env={**os.environ, "FIXTURE_SIGNAL": str(signum)}, text=True, capture_output=True, timeout=5)
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


@pytest.mark.skipif(os.name == "nt", reason="POSIX supervisor signals")
def test_supervisor_signal_during_event_critical_section_does_not_deadlock():
    code = '''
import os, signal
import poller
events = []
class Publisher:
    def send(self, record): events.append('send')
    def close(self): events.append('closed')
def wait(seconds):
    event = getattr(runtime.stop_event, '_event', runtime.stop_event)
    # A signal can interrupt Event.wait/set while its nonreentrant lock is held.
    with event._cond:
        os.kill(os.getpid(), signal.SIGTERM)
        os.kill(os.getpid(), signal.SIGINT)
runtime = poller.create_poller({'ODK_FUTU_CONTROL': ''}, publisher_factory=lambda context: Publisher(), wait=wait)
poller.run_supervised(runtime)
assert events == ['send', 'closed'], events
assert all(entry['state'] == 'stopped' for entry in runtime.catalog())
'''
    result = subprocess.run([sys.executable, "-c", code], cwd=Path(poller.__file__).parent,
                            text=True, capture_output=True, timeout=3)
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""


@pytest.mark.parametrize("import_fails", [False, True])
def test_sdk_import_cannot_replace_supervisor_interrupt_handler(monkeypatch, import_fails):
    import builtins
    from types import SimpleNamespace

    original_import = builtins.__import__
    sdk = SimpleNamespace(OpenSecTradeContext=lambda **_: object(), RET_OK=0, SecurityFirm=SimpleNamespace(FUTUSECURITIES=1),
                          SysConfig=object(), TrdMarket=SimpleNamespace(HK=1, US=2))
    supervisor_handler = lambda *_: None
    sdk_handler = lambda *_: None

    def sdk_import(name, *args, **kwargs):
        if name == "futu":
            signal.signal(signal.SIGINT, sdk_handler)
            if import_fails:
                raise ImportError("fixture SDK import failed")
            return sdk
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", sdk_import)
    context = SimpleNamespace(capability=lambda _: {"password": "fixture", "rsa_file": "", "host": "127.0.0.1", "port": 11111},
                              on_cleanup=lambda _: None)
    previous = signal.signal(signal.SIGINT, supervisor_handler)
    try:
        if import_fails:
            with pytest.raises(ImportError):
                poller.FutuGateway(context)
        else:
            assert len(poller.FutuGateway(context).contexts) == 2
        assert signal.getsignal(signal.SIGINT) is supervisor_handler
    finally:
        signal.signal(signal.SIGINT, previous)


def test_gateway_import_on_worker_thread_does_not_set_process_signals(monkeypatch):
    import threading
    from types import SimpleNamespace
    sdk = SimpleNamespace(OpenSecTradeContext=lambda **_: object(), RET_OK=0, SecurityFirm=SimpleNamespace(FUTUSECURITIES=1),
                          SysConfig=object(), TrdMarket=SimpleNamespace(HK=1, US=2))
    monkeypatch.setitem(sys.modules, "futu", sdk)
    context = SimpleNamespace(capability=lambda _: {"password": "fixture", "rsa_file": "", "host": "127.0.0.1", "port": 11111},
                              on_cleanup=lambda _: None)
    results = []
    def start():
        try:
            results.append(poller.FutuGateway(context))
        except Exception as error:
            results.append(error)
    thread = threading.Thread(target=start)
    thread.start()
    thread.join(timeout=3)
    assert not thread.is_alive()
    assert len(results) == 1 and isinstance(results[0], poller.FutuGateway)


def test_health_control_drip_has_one_total_budget(monkeypatch):
    import healthcheck
    from types import SimpleNamespace
    clock = [0.0]
    payload = iter(b'{"v":1,"id":"fixture","ok":true,"scope":"python-agent","plugins":[{"pluginId":"odk.futu.control"}]}\n')
    class Peer:
        def __enter__(self): return self
        def __exit__(self, *_): pass
        def settimeout(self, value): assert 0 < value <= 2
        def connect(self, endpoint): pass
        def sendall(self, data): pass
        def recv(self, size):
            clock[0] += 1.5
            return bytes([next(payload)])
    monkeypatch.setattr(healthcheck, "time", SimpleNamespace(monotonic=lambda: clock[0]), raising=False)
    monkeypatch.setattr(healthcheck.uuid, "uuid4", lambda: SimpleNamespace(hex="fixture"))
    monkeypatch.setattr(healthcheck.socket, "socket", lambda *_: Peer())
    monkeypatch.setattr(healthcheck, "management_settings", lambda *_: ("/fixture/control.sock", None))
    assert healthcheck.check_health({}) is False
    assert clock[0] <= 3.0


def test_source_package_refuses_source_and_destination_parent_aliases(tmp_path):
    from build_package import build_package, RUNTIME_FILES
    source = tmp_path / "source"
    source.mkdir()
    for name in RUNTIME_FILES: (source / name).write_text("fixture")
    alias = tmp_path / "alias"
    alias.symlink_to(source, target_is_directory=True)
    with pytest.raises(ValueError): build_package(tmp_path / "package", source=alias)
    parent = tmp_path / "parent"
    parent.mkdir()
    destination_alias = tmp_path / "destination-alias"
    destination_alias.symlink_to(parent, target_is_directory=True)
    with pytest.raises(ValueError): build_package(destination_alias / "package", source=source)
    assert not (parent / "package").exists()
