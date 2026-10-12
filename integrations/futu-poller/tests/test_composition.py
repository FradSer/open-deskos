"""Local plugin composition preserves the poller wire contract."""
import pytest
import poller


@pytest.mark.parametrize("component,operation", [("publisher", "send"), ("gateway", "snapshot"), ("loop", "run"), ("transport", "connect")])
def test_replacement_requires_callable_operation_before_running(component, operation):
    closed = []
    class Invalid:
        def close(self): closed.append(component)
    resource = Invalid()
    setattr(resource, operation, "not callable")
    class Publisher:
        def send(self, _record): pass
    class Gateway:
        def snapshot(self): return {"positions": [], "totals": {}}
    factories = {"publisher_factory": lambda context: Publisher(), "gateway_factory": lambda context: Gateway()}
    factories[component + "_factory"] = lambda context: resource
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture"}, **factories)
    with pytest.raises(TypeError, match=component + " requires callable " + operation):
        runtime.start()
    runtime.close()
    assert closed == [component]
    assert all(item["state"] != "running" for item in runtime.catalog())


def test_replacement_components_preserve_records_and_close_order():
    events = []
    class Publisher:
        def send(self, record): events.append(record)
        def close(self): events.append("publisher.close")
    class Gateway:
        def snapshot(self): return {"positions": [], "totals": {}}
        def close(self): events.append("gateway.close")
    def wait(_interval): raise KeyboardInterrupt
    runtime = poller.create_poller(
        {"FUTU_TRADE_PWD": "fixture"},
        publisher_factory=lambda context: Publisher(),
        gateway_factory=lambda context: Gateway(),
        wait=wait, clock=lambda: 12.5,
    )
    runtime.run()
    runtime.close()
    assert events == [{"type": "data", "snapshot": {"positions": [], "totals": {}, "updatedAt": 12500}}, "gateway.close", "publisher.close"]
    assert all(entry["state"] == "stopped" for entry in runtime.catalog())


def test_no_credentials_does_not_open_gateway():
    records = []
    class Publisher:
        def send(self, record): records.append(record)
        def close(self): pass
    def forbidden(_context): raise AssertionError("SDK loaded")
    def wait(_interval): raise KeyboardInterrupt
    poller.create_poller({}, publisher_factory=lambda context: Publisher(), gateway_factory=forbidden, wait=wait).run()
    assert records == [{"type": "auth-required", "secrets": ["futu-trade-password"]}]


def test_poll_failure_keeps_error_record_and_next_iteration():
    records = []
    class Publisher:
        def send(self, record): records.append(record)
        def close(self): pass
    class Gateway:
        def snapshot(self): raise RuntimeError("fixture failure")
        def close(self): pass
    def wait(_interval): raise KeyboardInterrupt
    poller.create_poller({"FUTU_TRADE_PWD": "fixture"}, publisher_factory=lambda context: Publisher(), gateway_factory=lambda context: Gateway(), wait=wait).run()
    assert records == [{"type": "error", "code": "poll-failed", "message": "RuntimeError: fixture failure"}]


def fake_sdk(monkeypatch, fail_market=None, fail_close=False):
    import sys
    import types
    events = []
    class Frame:
        def __init__(self, records): self.records = records
        def to_dict(self, orient):
            assert orient == "records"
            return self.records
    class Trade:
        def __init__(self, **options):
            self.market = options["filter_trdmarket"]
            events.append(("open", options))
            if self.market == fail_market: raise RuntimeError("open failure")
        def unlock_trade(self, password):
            assert password == "fixture"
            events.append(("unlock", self.market))
            return 0, None
        def position_list_query(self): return 0, Frame([])
        def accinfo_query(self): return 0, Frame([])
        def close(self):
            events.append(("close", self.market))
            if fail_close: raise RuntimeError("close failure")
    sdk = types.SimpleNamespace(
        OpenSecTradeContext=Trade, RET_OK=0,
        SecurityFirm=types.SimpleNamespace(FUTUSECURITIES="firm"),
        TrdMarket=types.SimpleNamespace(HK="HK", US="US"),
        SysConfig=types.SimpleNamespace(
            enable_proto_encrypt=lambda value: events.append(("encrypt", value)),
            set_init_rsa_file=lambda value: events.append(("rsa", value)),
        ),
    )
    monkeypatch.setitem(sys.modules, "futu", sdk)
    return events


def test_default_gateway_partial_initialization_closes_all_resources(monkeypatch):
    events = fake_sdk(monkeypatch, fail_market="US")
    class Publisher:
        def send(self, _record): pass
        def close(self): events.append("publisher.close")
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture"}, publisher_factory=lambda context: Publisher())
    with pytest.raises(RuntimeError, match="open failure"): runtime.start()
    runtime.close()
    assert events[-2:] == [("close", "HK"), "publisher.close"]
    assert sum(item == ("close", "HK") for item in events) == 1


def test_default_gateway_retains_market_unlock_and_encryption(monkeypatch):
    events = fake_sdk(monkeypatch)
    records = []
    class Publisher:
        def send(self, record): records.append(record)
        def close(self): events.append("publisher.close")
    def wait(_interval): raise KeyboardInterrupt
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture", "FUTU_RSA_FILE": "/fixture/key", "FUTU_HOST": "fixture-host", "FUTU_PORT": "1234"}, publisher_factory=lambda context: Publisher(), wait=wait, clock=lambda: 2)
    runtime.run()
    assert events[:2] == [("encrypt", True), ("rsa", "/fixture/key")]
    assert [item for item in events if isinstance(item, tuple) and item[0] == "unlock"] == [("unlock", "HK"), ("unlock", "US")]
    assert events[-3:] == [("close", "HK"), ("close", "US"), "publisher.close"]
    assert records[0]["type"] == "data"
    assert records[0]["snapshot"]["updatedAt"] == 2000
    assert all(item[1]["host"] == "fixture-host" and item[1]["port"] == 1234 for item in events if isinstance(item, tuple) and item[0] == "open")


def test_gateway_retains_unresolved_sdk_failure_without_reclosing_successes():
    events = []
    fail = True
    class Trade:
        def __init__(self, market): self.market = market
        def close(self):
            events.append(self.market)
            if self.market == "HK" and fail: raise RuntimeError("context busy")
    gateway = object.__new__(poller.FutuGateway)
    hk, us = Trade("HK"), Trade("US")
    gateway.contexts = [hk, us]
    gateway._close_failures = {}
    with pytest.raises(RuntimeError, match="context busy"): gateway.close()
    assert events == ["HK", "US"]
    assert gateway.contexts == [hk]
    fail = False
    for _attempt in range(2):
        with pytest.raises(RuntimeError, match="context busy"): gateway.close()
    assert events == ["HK", "US"]
    assert gateway.contexts == [hk]


def test_loop_and_credential_grants_can_be_replaced_without_secret_metadata():
    calls = []
    class Publisher:
        def send(self, _record): pass
        def close(self): calls.append("publisher.close")
    class Loop:
        def run(self): calls.append("replacement.run")
    def replacement(context):
        with pytest.raises(ValueError, match="undeclared capability"):
            context.capability("futu.credentials")
        return Loop()
    runtime = poller.create_poller({}, publisher_factory=lambda context: Publisher(), loop_factory=replacement)
    runtime.run()
    assert calls == ["replacement.run", "publisher.close"]
    assert "password" not in repr(runtime.catalog())


def test_failed_reenable_retains_original_error_and_closes_publisher():
    events = []
    failure = RuntimeError("replacement failed")
    class Publisher:
        def send(self, _record): pass
        def close(self): events.append("publisher.close")
    class Gateway:
        def snapshot(self): return {"positions": [], "totals": {}}
        def close(self): events.append("gateway.close")
    attempts = 0
    def gateway(context):
        nonlocal attempts
        attempts += 1
        if attempts > 1: raise failure
        return Gateway()
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture"}, publisher_factory=lambda context: Publisher(), gateway_factory=gateway)
    runtime.start(); runtime.set_enabled("odk.futu.gateway", False); runtime.set_enabled("odk.futu.gateway", True)
    with pytest.raises(RuntimeError) as caught: runtime.start()
    assert caught.value is failure
    assert events == ["gateway.close", "publisher.close"]


@pytest.mark.parametrize("management", ["off", "available", "occupied"])
def test_copied_cli_keeps_stdout_protocol_without_loading_sdk(tmp_path, management):
    import json
    import os
    import pathlib
    import shutil
    import subprocess
    import sys
    source = pathlib.Path(poller.__file__).parent
    for name in ("poller.py", "plugin_host.py", "plugin_config.py", "plugin_control.py", "management_channel.py"):
        shutil.copyfile(source / name, tmp_path / name)
    targets = tmp_path / "targets.json"
    targets.write_text('{"targets": []}', encoding="utf-8")
    code = """
import runpy, time
from pathlib import Path
def stop(_interval): raise KeyboardInterrupt
time.sleep = stop
runpy.run_path(str(Path('poller.py').resolve()), run_name='__main__')
"""
    env = {"PATH": os.environ.get("PATH", ""), "HOME": str(tmp_path), "ODESK_FUTU_TARGETS_FILE": str(targets), "SERVICE_ID": "fixture-service"}
    if management != "off":
        env["XDG_RUNTIME_DIR"] = str(tmp_path)
    if management == "occupied":
        directory = tmp_path / "open-deskos-futu"
        directory.mkdir(mode=0o700)
        (directory / "control.sock").write_text("preserved")
    result = subprocess.run(
        [sys.executable, "-c", code], cwd=tmp_path, capture_output=True, text=True,
        env=env,
        timeout=10, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stderr == ""
    assert json.loads(result.stdout) == {"v": 1, "service": "fixture-service", "type": "auth-required", "secrets": ["futu-trade-password"]}
    if management == "occupied":
        assert (directory / "control.sock").read_text() == "preserved"
