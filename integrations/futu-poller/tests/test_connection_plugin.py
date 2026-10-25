"""The publisher consumes a declared transport instead of a fixed connector."""
import json

import poller
import pytest


class Connection:
    def __init__(self): self.writes = []; self.closed = 0
    def sendall(self, packet): self.writes.append(json.loads(packet))
    def close(self): self.closed += 1


@pytest.mark.parametrize("endpoint", ["/tmp/controlled.sock", "tcp://127.0.0.1:9876", r"\\.\pipe\controlled"])
def test_replacement_transport_opens_each_endpoint_without_default_factory(monkeypatch, tmp_path, endpoint):
    token = tmp_path / "token"
    token.write_text("controlled-token")
    token.chmod(0o600)
    calls = []
    connection = Connection()
    class Transport:
        def connect(self, target):
            calls.append(target)
            return connection
    def forbidden(_endpoint): raise AssertionError("default connection factory ran")
    monkeypatch.setattr(poller, "open_connection", forbidden)
    runtime = poller.create_poller({"ODK_FUTU_SOCKET": endpoint, poller.TOKEN_ENV: str(token)},
                                   transport_factory=lambda context: Transport())
    runtime.start()
    runtime.host.get(poller.PORTS["publisher"]).send({"type": "data", "snapshot": {"positions": []}})
    assert calls == [poller.parse_endpoint(endpoint)]
    hello = next(record for record in connection.writes if record.get("type") == "hello")
    assert hello == {"v": 1, "type": "hello", "service": "futu-poller", "revision": "dev", "proto": 1}
    if poller.parse_endpoint(endpoint).requires_token:
        assert connection.writes[0] == {"v": 1, "token": "controlled-token"}
    assert connection.writes[-1] == {"v": 1, "type": "data", "service": "futu-poller", "snapshot": {"positions": []}}
    runtime.close()
    assert connection.closed == 1


def test_disabled_transport_blocks_default_publisher_without_opening_endpoints():
    def forbidden(_context): raise AssertionError("disabled transport factory ran")
    runtime = poller.create_poller({}, transport_factory=forbidden, disabled=("odk.futu.transport",))
    states = {entry["manifest"]["id"]: entry["state"] for entry in runtime.start()}
    assert states["odk.futu.transport"] == "disabled"
    assert states["odk.futu.publisher"] == states["odk.futu.loop"] == "blocked"
    runtime.close()


def test_custom_publisher_has_no_unused_transport_dependency():
    class Publisher:
        def send(self, _record): pass
    runtime = poller.create_poller({}, publisher_factory=lambda context: Publisher(), disabled=("odk.futu.transport",))
    runtime.start()
    assert runtime.host.get(poller.PORTS["publisher"]) is not None
    runtime.close()


def test_failed_consumer_cleanup_retains_transport_after_uncertain_close():
    events = []
    fail = [True]
    class FailingConnection(Connection):
        def close(self):
            events.append("connection.close")
            if fail[0]: raise RuntimeError("uncertain OS close")
    class Transport:
        def connect(self, endpoint): return FailingConnection()
        def close(self): events.append("transport.close")
    runtime = poller.create_poller({"ODK_FUTU_SOCKET": "/tmp/controlled.sock"}, transport_factory=lambda context: Transport())
    runtime.start()
    runtime.host.get(poller.PORTS["publisher"]).send({"type": "data", "snapshot": {}})
    with pytest.raises(RuntimeError): runtime.close()
    assert "transport.close" not in events
    assert next(entry for entry in runtime.catalog() if entry["manifest"]["id"] == "odk.futu.transport")["state"] == "cleanup-blocked"
    # Uncertain OS close failures remain sticky; retry cannot certify this handle.
    with pytest.raises(RuntimeError): runtime.close()
    assert events == ["connection.close"]


def test_async_connection_results_are_rejected_before_link_ownership(capsys):
    import inspect
    pending = []
    class Transport:
        def connect(self, endpoint):
            async def unsupported(): raise AssertionError("async connection ran")
            result = unsupported()
            pending.append(result)
            return result
    runtime = poller.create_poller({"ODK_FUTU_SOCKET": "/tmp/controlled.sock"}, transport_factory=lambda context: Transport())
    runtime.start()
    publisher = runtime.host.get(poller.PORTS["publisher"])
    publisher.send({"type": "data", "snapshot": {}})
    assert inspect.getcoroutinestate(pending[0]) == inspect.CORO_CLOSED
    assert publisher.links[0].conn is None
    assert "must be synchronous" in capsys.readouterr().err
    runtime.close()


def test_readable_replacement_without_socket_readiness_is_rejected_and_closed():
    connection = Connection()
    connection.recv = lambda size: b""
    connection.gettimeout = lambda: 1
    connection.settimeout = lambda timeout: None
    class Transport:
        def connect(self, endpoint): return connection
    runtime = poller.create_poller({"ODK_FUTU_SOCKET": "/tmp/controlled.sock"}, transport_factory=lambda context: Transport())
    runtime.start()
    publisher = runtime.host.get(poller.PORTS["publisher"])
    publisher.send({"type": "data", "snapshot": {}})
    assert publisher.links[0].conn is None
    assert connection.writes == []
    assert connection.closed == 1
    runtime.close()


def test_invalid_wait_descriptor_does_not_stop_another_link():
    import socket
    runtime = poller.create_poller({})
    def peer(connection):
        target = poller.Target(endpoint="/tmp/controlled.sock", parsed=poller.parse_endpoint("/tmp/controlled.sock"))
        link = poller.ShellLink(target, "futu-poller", "dev", runtime_report=runtime.diagnose)
        link.conn = connection
        link._runtime_negotiated = True
        return link
    local_bad, remote_bad = socket.socketpair()
    local_good, remote_good = socket.socketpair()
    bad = peer(local_bad)
    good = peer(local_good)
    local_bad.close()
    try:
        remote_good.sendall(poller.frame({"v": 1, "type": "runtime_diagnosis", "service": "futu-poller", "requestId": "a" * 32}))
        poller.LinkSet([bad, good], "futu-poller").wait(0.05)
        assert bad.conn is None
        remote_good.settimeout(1)
        assert json.loads(remote_good.recv(65536))["type"] == "runtime_diagnosis_result"
    finally:
        for connection in (local_bad, remote_bad, local_good, remote_good): connection.close()
