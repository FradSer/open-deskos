"""Explicit Python startup replacements preserve inspection and trust boundaries."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest
import poller
from development_plugins import load_replacements


def package(tmp_path, component="loop", entry=None):
    root = tmp_path / component
    root.mkdir()
    baseline = next(item["manifest"] for item in poller.create_poller({}).catalog()
                    if item["manifest"]["id"] == "odk.futu." + component)
    manifest = {**baseline, "version": "2.0.0", "entry": "entry.py"}
    (root / "manifest.json").write_text(json.dumps(manifest))
    marker = tmp_path / "imported"
    (root / "entry.py").write_text(entry or (
        "from pathlib import Path\n"
        f"Path({str(marker)!r}).write_text('imported')\n"
        "class Component:\n"
        "    def run(self): print('replacement ran')\n"
        "    def snapshot(self): return {}\n"
        "    def connect(self, endpoint): raise AssertionError('unexpected endpoint')\n"
        "    def send(self, record): pass\n"
        "def create(context): return Component()\n"))
    grants = tuple(manifest["id"] + ":" + name for name in manifest["permissions"])
    return root, marker, grants


def contracts():
    return [item["manifest"] for item in poller.create_poller({}).catalog()]


def test_loader_is_lazy_and_runtime_preserves_replacement_metadata(tmp_path, capsys):
    root, marker, grants = package(tmp_path)
    replacements = load_replacements([root], contracts(), trusted=True, grants=grants)
    assert not marker.exists()
    runtime = poller.create_poller({}, replacement_plugins=replacements)
    runtime.host.validate()
    assert not marker.exists()
    manifest = next(item["manifest"] for item in runtime.catalog() if item["manifest"]["id"] == "odk.futu.loop")
    assert manifest["version"] == "2.0.0"
    assert "entry" not in manifest
    runtime.run()
    assert marker.read_text() == "imported"
    assert "replacement ran" in capsys.readouterr().out


@pytest.mark.parametrize("trusted,missing", [(False, False), (True, True)])
def test_trust_and_grants_are_required_before_import(tmp_path, trusted, missing):
    root, marker, grants = package(tmp_path)
    with pytest.raises(ValueError):
        load_replacements([root], contracts(), trusted=trusted, grants=() if missing else grants)
    assert not marker.exists()


@pytest.mark.parametrize("change", [
    {"id": "odk.futu.unknown"}, {"host": "electron-main"}, {"kind": "transport"},
    {"provides": [{"interface": "odk:futu/loop/v2"}]}, {"permissions": ["futu.credentials"]},
    {"entry": "../outside.py"}, {"entry": "/outside.py"}, {"entry": "missing.py"},
])
def test_invalid_packages_do_not_execute_entry(tmp_path, change):
    root, marker, grants = package(tmp_path)
    manifest = json.loads((root / "manifest.json").read_text())
    manifest.update(change)
    (root / "manifest.json").write_text(json.dumps(manifest))
    with pytest.raises(ValueError):
        load_replacements([root], contracts(), trusted=True, grants=grants)
    assert not marker.exists()


@pytest.mark.parametrize("component", ["loop", "gateway"])
def test_excluded_factories_never_import(tmp_path, component):
    root, marker, grants = package(tmp_path, component)
    replacements = load_replacements([root], contracts(), trusted=True, grants=grants)
    runtime = poller.create_poller({}, replacement_plugins=replacements,
                                  disabled=("odk.futu.loop",) if component == "loop" else ())
    runtime.start()
    assert not marker.exists()
    runtime.close()


def test_cli_inspection_and_operational_selection(tmp_path):
    root, marker, grants = package(tmp_path)
    args = [sys.executable, poller.__file__, "--plugin-directory", str(root), "--trust-plugins"]
    for grant in grants:
        args.extend(["--grant-plugin", grant])
    inspected = subprocess.run([*args, "--plugins", "validate"], capture_output=True, text=True, timeout=10)
    assert inspected.returncode == 0, inspected.stderr
    report = json.loads(inspected.stdout)
    assert next(item["manifest"]["version"] for item in report["plugins"] if item["manifest"]["id"] == "odk.futu.loop") == "2.0.0"
    assert not marker.exists()
    ran = subprocess.run(args, capture_output=True, text=True, timeout=10,
                         env={"PATH": str(Path(sys.executable).parent), "FUTU_INTERVAL": "60"})
    assert ran.returncode == 0, ran.stderr
    assert marker.exists()
    assert "replacement ran" in ran.stdout


@pytest.mark.parametrize("invalid", ["duplicate", "symlink", "fifo", "manifest-size", "entry-size", "duplicate-json"])
def test_loader_rejects_invalid_file_boundaries_before_execution(tmp_path, invalid):
    root, marker, grants = package(tmp_path)
    directories = [root]
    if invalid == "duplicate":
        directories.append(root)
    elif invalid == "symlink":
        outside = tmp_path / "outside.py"
        outside.write_text("raise AssertionError('outside entry executed')")
        (root / "entry.py").unlink()
        (root / "entry.py").symlink_to(outside)
    elif invalid == "fifo":
        if not hasattr(os, "mkfifo"):
            pytest.skip("FIFO files are unavailable on this host")
        (root / "entry.py").unlink()
        os.mkfifo(root / "entry.py")
    elif invalid == "manifest-size":
        (root / "manifest.json").write_bytes(b" " * 16385)
    elif invalid == "entry-size":
        (root / "entry.py").write_bytes(b" " * (256 * 1024 + 1))
    else:
        (root / "manifest.json").write_text('{"id":"odk.futu.loop","id":"odk.futu.loop"}')
    with pytest.raises(ValueError):
        load_replacements(directories, contracts(), trusted=True, grants=grants)
    assert not marker.exists()


def test_selected_entry_bytes_are_stable_and_module_generations_are_distinct(tmp_path):
    root, marker, grants = package(tmp_path)
    first = load_replacements([root], contracts(), trusted=True, grants=grants)
    second = load_replacements([root], contracts(), trusted=True, grants=grants)
    (root / "entry.py").write_text("raise AssertionError('changed entry executed')")
    one = poller.create_poller({}, replacement_plugins=first)
    two = poller.create_poller({}, replacement_plugins=second)
    try:
        one.start()
        two.start()
        assert marker.exists()
        assert type(one.host.get(poller.PORTS["loop"])).__module__ != type(two.host.get(poller.PORTS["loop"])).__module__
    finally:
        one.close()
        two.close()


def test_invalid_graph_and_duplicate_factory_selection_do_not_import(tmp_path):
    root, marker, grants = package(tmp_path)
    manifest = json.loads((root / "manifest.json").read_text())
    manifest["requires"] = [{"interface": poller.PORTS["loop"]}]
    (root / "manifest.json").write_text(json.dumps(manifest))
    replacements = load_replacements([root], contracts(), trusted=True, grants=grants)
    runtime = poller.create_poller({}, replacement_plugins=replacements)
    with pytest.raises(ValueError, match="cycle"):
        runtime.host.validate()
    with pytest.raises(ValueError, match="duplicate"):
        poller.create_poller({}, replacement_plugins=replacements, loop_factory=lambda context: object())
    assert not marker.exists()


def test_parent_symlink_swap_never_captures_outside_entry(tmp_path, monkeypatch):
    root, marker, grants = package(tmp_path)
    source = root / "src"
    source.mkdir()
    (root / "entry.py").rename(source / "entry.py")
    manifest = json.loads((root / "manifest.json").read_text())
    manifest["entry"] = "src/entry.py"
    (root / "manifest.json").write_text(json.dumps(manifest))
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "entry.py").write_text("def create(context): return 'outside'\n")
    actual_open = os.open
    swapped = False

    def changing_open(path, flags, *args, **kwargs):
        nonlocal swapped
        if not swapped and Path(path).name in ("src", "entry.py"):
            source.rename(root / "original-src")
            source.symlink_to(outside, target_is_directory=True)
            swapped = True
        return actual_open(path, flags, *args, **kwargs)

    monkeypatch.setattr(os, "open", changing_open)
    try:
        replacements = load_replacements([root], contracts(), trusted=True, grants=grants)
    except ValueError:
        assert swapped
        assert not marker.exists()
    else:
        selected = replacements["odk.futu.loop"]["create"](None)
        assert selected != "outside"


@pytest.mark.parametrize("final_path,accepted", [
    (r"\\?\C:\package\entry.py", True),
    (r"\\?\UNC\server\share\entry.py", True),
    (r"\\?\C:\outside\entry.py", False),
    ("", False),
])
def test_windows_handle_verification_and_failed_handle_release(tmp_path, monkeypatch, final_path, accepted):
    import ctypes
    import ntpath
    from pathlib import PureWindowsPath
    from types import SimpleNamespace
    import development_plugins

    target = PureWindowsPath(r"\\server\share\entry.py" if "UNC" in final_path else r"C:\package\entry.py")
    source = tmp_path / "bytes"
    source.write_bytes(b"selected")
    descriptor = os.open(source, os.O_RDONLY)

    class GetPath:
        def __call__(self, handle, buffer, capacity, flags):
            assert handle == descriptor
            assert flags == 0
            buffer.value = final_path
            return len(final_path)

    monkeypatch.setattr(ctypes, "WinDLL", lambda *args, **kwargs: SimpleNamespace(GetFinalPathNameByHandleW=GetPath()), raising=False)
    monkeypatch.setitem(sys.modules, "msvcrt", SimpleNamespace(get_osfhandle=lambda fd: fd))
    monkeypatch.setattr(development_plugins, "os", SimpleNamespace(
        name="nt", O_RDONLY=os.O_RDONLY, open=lambda *args: descriptor,
        close=os.close, path=SimpleNamespace(normcase=ntpath.normcase)))
    if accepted:
        try:
            assert development_plugins._open_selected(target) == descriptor
            assert os.read(descriptor, 20) == b"selected"
        finally:
            os.close(descriptor)
    else:
        with pytest.raises(OSError):
            development_plugins._open_selected(target)
        with pytest.raises(OSError):
            os.fstat(descriptor)


@pytest.mark.parametrize("component,operation", [("publisher", "send"), ("gateway", "snapshot"), ("loop", "run"), ("transport", "connect")])
def test_external_entries_supply_each_component_port(tmp_path, component, operation):
    root, marker, grants = package(tmp_path, component, entry=(
        "class Component:\n"
        "    def send(self, record): return record\n"
        "    def snapshot(self): return {'replacement': True}\n"
        "    def run(self): return 'external-loop'\n"
        "    def connect(self, endpoint): return endpoint\n"
        "def create(context): return Component()\n"))
    replacements = load_replacements([root], contracts(), trusted=True, grants=grants)
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "synthetic"} if component == "gateway" else {},
                                  replacement_plugins=replacements)
    try:
        runtime.start()
        selected = runtime.host.get(poller.PORTS[component])
        result = getattr(selected, operation)("synthetic") if component in ("publisher", "transport") else getattr(selected, operation)()
        assert result == ({"replacement": True} if component == "gateway" else "external-loop" if component == "loop" else "synthetic")
        assert type(selected).__module__.startswith("_odk_futu_")
    finally:
        runtime.close()


@pytest.mark.parametrize("target_name,final_name", [
    (r"\\?\C:\package\entry.py", r"\\?\C:\package\entry.py"),
    (r"\\?\UNC\server\share\entry.py", r"\\?\UNC\server\share\entry.py"),
])
def test_windows_extended_selected_path_matches_opened_handle(tmp_path, monkeypatch, target_name, final_name):
    import ctypes
    import ntpath
    from pathlib import PureWindowsPath
    from types import SimpleNamespace
    import development_plugins
    source = tmp_path / "entry"
    source.write_bytes(b"selected")
    descriptor = os.open(source, os.O_RDONLY)

    class GetPath:
        def __call__(self, handle, buffer, capacity, flags):
            buffer.value = final_name
            return len(final_name)

    monkeypatch.setattr(ctypes, "WinDLL", lambda *args, **kwargs: SimpleNamespace(GetFinalPathNameByHandleW=GetPath()), raising=False)
    monkeypatch.setitem(sys.modules, "msvcrt", SimpleNamespace(get_osfhandle=lambda fd: fd))
    monkeypatch.setattr(development_plugins, "os", SimpleNamespace(
        name="nt", O_RDONLY=os.O_RDONLY, open=lambda *args: descriptor,
        close=os.close, path=SimpleNamespace(normcase=ntpath.normcase)))
    try:
        result = development_plugins._open_selected(PureWindowsPath(target_name))
        assert result == descriptor
        assert os.read(result, 20) == b"selected"
    finally:
        try:
            os.close(descriptor)
        except OSError:
            pass


@pytest.mark.parametrize("entry,expected,cleanup", [
    ("def create(:\n", "SyntaxError", False),
    ("value = 1\n", "requires callable create", False),
    ("def create(context):\n"
     "    context.on_cleanup(lambda: Path(CLEANUP).write_text('released'))\n"
     "    raise RuntimeError('synthetic initialization failure')\n", "synthetic initialization failure", True),
    ("class Component:\n"
     "    def run(self): raise RuntimeError('synthetic loop failure')\n"
     "    def close(self): Path(CLEANUP).write_text('released')\n"
     "def create(context): return Component()\n", "synthetic loop failure", True),
])
def test_operational_cli_fails_and_releases_selected_entry(tmp_path, entry, expected, cleanup):
    released = tmp_path / "released"
    if cleanup:
        entry = "from pathlib import Path\n" + f"CLEANUP = {str(released)!r}\n" + entry
    root, marker, grants = package(tmp_path, entry=entry)
    args = [sys.executable, poller.__file__, "--plugin-directory", str(root), "--trust-plugins"]
    for grant in grants:
        args.extend(["--grant-plugin", grant])
    result = subprocess.run(args, capture_output=True, text=True, timeout=10,
                            env={"PATH": str(Path(sys.executable).parent)})
    assert result.returncode != 0
    assert expected in result.stderr
    assert released.exists() == cleanup
    if cleanup:
        assert released.read_text() == "released"
