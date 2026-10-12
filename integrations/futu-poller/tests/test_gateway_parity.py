"""Shared protocol acceptance for default and independently loaded gateways."""
import importlib.util
import io
import json
from pathlib import Path
import sys

import poller
import pytest

from test_composition import fake_sdk


@pytest.fixture(params=("default", "replacement"))
def gateway_factory(request, monkeypatch):
    source = Path(__file__).parent / "fixtures/replacement_gateway.py"
    spec = importlib.util.spec_from_file_location("futu_gateway_parity_fixture", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if request.param == "replacement":
        def forbidden(*_args, **_kwargs): raise AssertionError("built-in gateway used by replacement")
        monkeypatch.setattr(poller, "FutuGateway", forbidden)
        monkeypatch.setattr(poller, "poll_once", forbidden)
        return lambda fail_once: lambda context: module.ReplacementGateway(context, fail_once), module.SNAPSHOT
    fake_sdk(monkeypatch)
    sdk = sys.modules["futu"]
    class Frame:
        def __init__(self, records): self.records = records
        def to_dict(self, orient):
            assert orient == "records"
            return self.records
    def create(fail_once):
        remaining_failure = fail_once
        def positions(trade):
            nonlocal remaining_failure
            if remaining_failure:
                remaining_failure = False
                return 1, "fixture failure"
            return 0, Frame([{"code": "HK.fixture", "stock_name": "Fixture", "market": "HK", "qty": 2,
                              "cost_price": 4, "nominal_price": 5, "market_val": 10, "pl_val": 2,
                              "pl_ratio": 0.25, "today_pl_val": 1, "currency": "hkd"}] if trade.market == "HK" else [])
        sdk.OpenSecTradeContext.position_list_query = positions
        sdk.OpenSecTradeContext.accinfo_query = lambda trade: (0, Frame([{"cash": 7 if trade.market == "HK" else 3}]))
        return poller.FutuGateway
    return create, module.SNAPSHOT


@pytest.mark.parametrize("fail_once", (False, True))
def test_gateway_preserves_protocol_values_timing_and_failure_recovery(gateway_factory, fail_once):
    create, expected = gateway_factory
    output = io.StringIO()
    intervals = []
    def publisher(context):
        service, _revision = context.capability("desk.identity")
        return poller.LinkSet([], service, stdout=output)
    def wait(interval):
        intervals.append(interval)
        if len(intervals) == 2: raise KeyboardInterrupt
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture", "FUTU_INTERVAL": "7", "SERVICE_ID": "fixture-service"},
                                  publisher_factory=publisher, gateway_factory=create(fail_once), wait=wait, clock=lambda: 12.5)
    runtime.run()
    records = [json.loads(line) for line in output.getvalue().splitlines()]
    data = {"v": 1, "service": "fixture-service", "type": "data", "snapshot": {**expected, "updatedAt": 12500}}
    first = {"v": 1, "service": "fixture-service", "type": "error", "code": "poll-failed",
             "message": "RuntimeError: position_list_query failed: fixture failure"} if fail_once else data
    assert records == [first, data]
    assert intervals == [7, 7]
    assert all(item["state"] == "stopped" for item in runtime.catalog())


def test_gateway_factory_is_excluded_without_authentication(gateway_factory):
    create, _expected = gateway_factory
    selected = create(False)
    calls = []
    def factory(context):
        calls.append("gateway")
        return selected(context)
    output = io.StringIO()
    def wait(_interval): raise KeyboardInterrupt
    runtime = poller.create_poller({}, gateway_factory=factory,
                                  publisher_factory=lambda context: poller.LinkSet([], "fixture", stdout=output), wait=wait)
    runtime.run()
    assert calls == []
    assert json.loads(output.getvalue()) == {"v": 1, "service": "fixture", "type": "auth-required", "secrets": ["futu-trade-password"]}


def test_gateway_disable_blocks_polling_and_preserves_publisher(gateway_factory):
    create, _expected = gateway_factory
    calls = []
    selected = create(False)
    def factory(context):
        calls.append("gateway")
        return selected(context)
    runtime = poller.create_poller({"FUTU_TRADE_PWD": "fixture"}, gateway_factory=factory,
                                  publisher_factory=lambda context: poller.LinkSet([], "fixture", stdout=io.StringIO()),
                                  disabled=("odk.futu.gateway",))
    states = {item["manifest"]["id"]: item["state"] for item in runtime.start()}
    assert states == {"odk.futu.publisher": "running", "odk.futu.gateway": "disabled", "odk.futu.loop": "blocked", "odk.futu.transport": "running"}
    assert calls == []
    runtime.close()
