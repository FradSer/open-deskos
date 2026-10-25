"""Transactions exercise package revisions independently of provider accounts."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import pytest

from odk_service_runtime.manager import ServiceRuntime


def package(tmp_path, version="1.0.0"):
    source = tmp_path / version
    source.mkdir()
    inputs = {"main.py": b"print('fixture')", "pyproject.toml": b"[project]\nname='fixture'\nversion='1'\ndependencies=[]\n", "uv.lock": b"version = 1\n", ".python-version": b"3.12.11\n"}
    for name, content in inputs.items(): (source / name).write_bytes(content)
    manifest = {"schemaVersion": 1, "id": "odk.test.worker", "name": "Fixture", "version": version,
                "runtime": {"kind": "python", "python": "3.12.11", "entry": "main.py", "args": []},
                "files": [{"path": name, "sha256": hashlib.sha256(content).hexdigest()} for name, content in sorted(inputs.items())],
                "health": {"kind": "exec", "argv": ["{python}", "main.py"], "timeoutSeconds": 1}}
    (source / "service.json").write_text(json.dumps(manifest))
    return source


class Backend:
    def __init__(self): self.prepared = []
    def prepare(self, path, manifest): self.prepared.append(path)
    def command(self, path, manifest): return ["python", str(path / "main.py")]


class Controller:
    def __init__(self): self.live = {}; self.calls = []; self.fail_stop = False
    def reserve(self, service_id, revision, manifest, config, state_directory):
        return {"id": service_id, "revision": revision, "backend": "python"}
    def start(self, service_id, revision, manifest, config, state_directory, *, handle=None):
        self.calls.append(("start", revision)); self.live[revision] = handle; return handle
    def stop(self, handle):
        self.calls.append(("stop", handle["revision"]))
        if self.fail_stop: raise RuntimeError("stop unconfirmed")
        self.live.pop(handle["revision"], None)
    def remove(self, handle): self.stop(handle)
    def status(self, handle): return {"state": "running" if handle["revision"] in self.live else "exited"}


@pytest.fixture
def setup(tmp_path):
    backend, controller = Backend(), Controller()
    runtime = ServiceRuntime(tmp_path / "state", python_backend=backend, controller=controller, probe=lambda *_: None)
    return runtime, backend, controller


def test_install_enable_disable_rollback_remove_preserve_configuration(tmp_path, setup):
    runtime, backend, controller = setup
    config = {"envFile": None, "mounts": [], "uid": 1000, "gid": 1000}
    with pytest.raises(ValueError, match="trust"): runtime.install(package(tmp_path), config)
    first = runtime.install(tmp_path / "1.0.0", config, trusted=True)
    assert first["enabled"] is False and controller.calls == []
    runtime.enable("odk.test.worker")
    runtime.install(tmp_path / "1.0.0", config, trusted=True)
    assert len(backend.prepared) == 1
    second = runtime.install(package(tmp_path, "2.0.0"), config, trusted=True)
    assert second["previous"] == first["selected"] and second["enabled"]
    runtime.rollback("odk.test.worker")
    assert runtime.inspect("odk.test.worker")["selected"] == first["selected"]
    runtime.disable("odk.test.worker")
    assert not controller.live
    runtime.remove("odk.test.worker")
    assert runtime.list() == []
    assert (runtime.root / "revisions" / "odk.test.worker" / first["selected"]).is_dir()
    assert len(backend.prepared) == 2


def test_failed_readiness_restores_old_revision_and_uncertain_stop_blocks_changes(tmp_path, setup):
    runtime, _, controller = setup
    config = {"envFile": None, "mounts": [], "uid": 1000, "gid": 1000}
    first = runtime.install(package(tmp_path), config, trusted=True)
    runtime.enable("odk.test.worker")
    runtime.probe = lambda _directory, manifest, _config, _handle: (_ for _ in ()).throw(RuntimeError("unready")) if manifest["version"] == "2.0.0" else None
    with pytest.raises(RuntimeError): runtime.install(package(tmp_path, "2.0.0"), config, trusted=True)
    current = runtime.inspect("odk.test.worker")
    assert current["selected"] == first["selected"] and current["enabled"]
    assert list(controller.live) == [first["selected"]]
    controller.fail_stop = True
    with pytest.raises(RuntimeError): runtime.disable("odk.test.worker")
    assert runtime.inspect("odk.test.worker")["state"] == "cleanup_pending"
    with pytest.raises(RuntimeError): runtime.enable("odk.test.worker")


def test_hashes_links_and_unknown_inputs_fail_before_preparation(tmp_path, setup):
    runtime, backend, _ = setup
    source = package(tmp_path)
    (source / "secret.env").write_text("FIXTURE_ONLY=true")
    with pytest.raises(ValueError): runtime.install(source, {}, trusted=True)
    (source / "secret.env").unlink()
    (source / "main.py").write_text("changed")
    with pytest.raises(ValueError): runtime.install(source, {}, trusted=True)
    assert backend.prepared == []


def test_interrupted_creation_keeps_durable_reservation_for_recovery(tmp_path, setup):
    runtime, backend, controller = setup
    runtime.install(package(tmp_path), {}, trusted=True)
    original_start = controller.start
    def interrupted(*args, **kwargs):
        original_start(*args, **kwargs)
        raise KeyboardInterrupt()
    controller.start = interrupted
    with pytest.raises(KeyboardInterrupt): runtime.enable("odk.test.worker")
    assert runtime.inspect("odk.test.worker").get("handle")
    restarted = ServiceRuntime(runtime.root, python_backend=backend, controller=controller)
    restarted.disable("odk.test.worker")
    assert not controller.live
    assert restarted.inspect("odk.test.worker")["state"] == "disabled"


def test_candidate_is_authorized_until_activation_selection_commits(tmp_path, setup):
    runtime, _, controller = setup
    first = runtime.install(package(tmp_path), {}, trusted=True)
    runtime.enable(first["id"])
    save = runtime._save
    def interrupt_before_selection(state):
        record = state["services"][first["id"]]
        if record.get("selected") != first["selected"]:
            raise KeyboardInterrupt()
        save(state)
    runtime._save = interrupt_before_selection
    with pytest.raises(KeyboardInterrupt): runtime.install(package(tmp_path, "2.0.0"), {}, trusted=True)
    interrupted = runtime.inspect(first["id"])
    candidate = interrupted["handle"]["revision"]
    assert candidate == interrupted.get("pending")
    assert interrupted["state"] == "starting"
    with pytest.raises(RuntimeError, match="Reconcile"): runtime.enable(first["id"])
    runtime._save = save
    runtime.disable(first["id"])
    assert not controller.live


def test_damaged_code_does_not_prevent_owned_cleanup(tmp_path, setup):
    runtime, _, controller = setup
    record = runtime.install(package(tmp_path), {}, trusted=True)
    runtime.enable("odk.test.worker")
    retained = runtime.root / "revisions" / record["id"] / record["selected"] / "main.py"
    retained.write_text("damaged")
    runtime.disable(record["id"])
    assert not controller.live
    with pytest.raises(ValueError, match="integrity"): runtime.enable(record["id"])


def test_fifo_descriptor_is_rejected_without_blocking(tmp_path):
    source = package(tmp_path)
    (source / "service.json").unlink()
    os.mkfifo(source / "service.json")
    result = subprocess.run([sys.executable, "-c", "from pathlib import Path; from odk_service_runtime.manifest import read_package; read_package(Path(__import__('sys').argv[1]))", str(source)], capture_output=True, timeout=2)
    assert result.returncode != 0


def test_corrupt_state_cannot_redirect_cleanup(tmp_path, setup):
    runtime, _, controller = setup
    runtime.install(package(tmp_path), {}, trusted=True)
    state = json.loads(runtime.state_file.read_text())
    state["services"]["odk.test.worker"]["id"] = "another.service"
    runtime.state_file.write_text(json.dumps(state))
    with pytest.raises(ValueError, match="state"): runtime.disable("odk.test.worker")
    assert not controller.calls


def _foreground(tmp_path, setup, code):
    runtime, _, _ = setup
    source = package(tmp_path)
    (source / "main.py").write_text(code)
    manifest = json.loads((source / "service.json").read_text())
    manifest["stopTimeoutSeconds"] = 1
    next(item for item in manifest["files"] if item["path"] == "main.py")["sha256"] = hashlib.sha256(code.encode()).hexdigest()
    (source / "service.json").write_text(json.dumps(manifest))
    runtime.install(source, {}, trusted=True)
    script = "from pathlib import Path; import sys; from odk_service_runtime.manager import ServiceRuntime; from odk_service_runtime.python_backend import PythonBackend; PythonBackend.command=lambda self,p,m:[sys.executable,str(p/'main.py')]; raise SystemExit(ServiceRuntime(Path(sys.argv[1])).run_foreground('odk.test.worker'))"
    process = subprocess.Popen([sys.executable, "-c", script, str(runtime.root)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    return runtime, process, script


def _wait_file(path, process):
    deadline = time.monotonic() + 5
    while not path.exists() and time.monotonic() < deadline:
        assert process.poll() is None, process.stderr.read().decode()
        time.sleep(0.02)
    assert path.exists()


def test_foreground_cleans_descendants_after_entry_exits(tmp_path, setup):
    child = "import os,signal,time; from pathlib import Path; p=Path(os.environ['HOME']); signal.signal(signal.SIGTERM,lambda *_:(p.joinpath('stopped').write_text('yes'),exit(0))); p.joinpath('ready').write_text('yes'); time.sleep(30)"
    code = f"import os,subprocess,sys,time\nfrom pathlib import Path\np=Path(os.environ['HOME'])\nsubprocess.Popen([sys.executable,'-c',{child!r}])\nwhile not (p/'ready').exists(): time.sleep(.01)\n"
    runtime, process, _ = _foreground(tmp_path, setup, code)
    try:
        assert process.wait(timeout=4) == 0, process.stderr.read().decode()
        assert (runtime.root / "data" / "odk.test.worker" / "stopped").exists()
    finally:
        if process.poll() is None: process.terminate(); process.wait(timeout=4)


def test_foreground_lease_refuses_duplicates_and_forwards_signal(tmp_path, setup):
    code = "import os,signal,time\nfrom pathlib import Path\np=Path(os.environ['HOME'])\nsignal.signal(signal.SIGTERM,lambda *_:(p.joinpath('stopped').write_text('yes'),exit(0)))\np.joinpath('ready').write_text('yes')\ntime.sleep(30)\n"
    runtime, process, script = _foreground(tmp_path, setup, code)
    try:
        data = runtime.root / "data" / "odk.test.worker"
        _wait_file(data / "ready", process)
        duplicate = subprocess.run([sys.executable, "-c", script, str(runtime.root)], capture_output=True, timeout=3)
        assert duplicate.returncode != 0
        process.terminate()
        assert process.wait(timeout=4) == 0
        assert (data / "stopped").exists()
    finally:
        if process.poll() is None: process.terminate(); process.wait(timeout=4)


def test_foreground_signal_during_wait_grants_full_shutdown_deadline(tmp_path, setup):
    code = "import os,signal,time\nfrom pathlib import Path\np=Path(os.environ['HOME'])\ndef stop(*_):\n time.sleep(.6)\n p.joinpath('stopped').write_text('yes')\n exit(0)\nsignal.signal(signal.SIGTERM,stop)\np.joinpath('ready').write_text('yes')\ntime.sleep(30)\n"
    runtime, process, _ = _foreground(tmp_path, setup, code)
    try:
        data = runtime.root / "data" / "odk.test.worker"
        _wait_file(data / "ready", process)
        process.terminate()
        assert process.wait(timeout=4) == 0, process.stderr.read().decode()
        assert (data / "stopped").exists()
    finally:
        if process.poll() is None: process.kill(); process.wait(timeout=4)


def test_readiness_retries_share_one_budget_and_refuse_late_success(tmp_path, monkeypatch):
    import odk_service_runtime.manager as module
    clock = [0.0]
    class Docker:
        def __init__(self): self.calls = 0; self.deadlines = []
        def health(self, *args, deadline=None):
            self.deadlines.append(deadline)
            self.calls += 1
            clock[0] += 59
            if self.calls == 1: raise RuntimeError("not ready")
    docker = Docker()
    runtime = ServiceRuntime(tmp_path / "state", docker_backend=docker)
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(module.time, "sleep", lambda value: clock.__setitem__(0, clock[0] + value))
    with pytest.raises(RuntimeError, match="deadline"):
        runtime._probe(tmp_path, {"health": {"timeoutSeconds": 60}}, {}, {"backend": "docker"})
    assert docker.deadlines == [60, 60]


def test_python_readiness_refuses_success_after_deadline(tmp_path, monkeypatch):
    import odk_service_runtime.manager as module
    clock = [0.0]
    controller = Controller()
    controller.live["fixture"] = {}
    runtime = ServiceRuntime(tmp_path / "state", python_backend=Backend(), controller=controller)
    monkeypatch.setattr(module.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(module.subprocess, "run", lambda *args, **kwargs: clock.__setitem__(0, 11.0))
    with pytest.raises(RuntimeError, match="deadline"):
        runtime._probe(tmp_path, {"id":"odk.test.worker", "health":{"argv":["{python}"],"timeoutSeconds":10}}, {}, {"backend":"python","revision":"fixture"})
