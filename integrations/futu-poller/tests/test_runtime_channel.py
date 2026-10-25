"""Negotiated diagnosis does not add another provider or thread."""
import json

import poller


class Connection:
    def __init__(self): self.written = []
    def sendall(self, data): self.written.append(json.loads(data))
    def recv(self, size): return b""
    def close(self): pass


def link():
    target = poller.Target(endpoint="/tmp/controlled-runtime.sock", parsed=poller.parse_endpoint("/tmp/controlled-runtime.sock"), label="controlled")
    runtime = poller.create_poller({"ODK_FUTU_SOCKET": "/tmp/odk-fixture-unbound.sock"})
    peer = poller.ShellLink(target, "futu-poller", "dev", runtime_report=runtime.diagnose)
    peer.conn = Connection()
    return peer


def request(peer, **changes):
    record = {"v": 1, "type": "runtime_diagnosis", "service": "futu-poller", "requestId": "a" * 32}
    record.update(changes)
    peer._state_reply(json.dumps(record).encode())


def test_negotiated_request_returns_actual_owned_composition():
    peer = link()
    request(peer)
    assert peer.conn.written == []
    peer._state_reply(b'{"v":1,"type":"ack","ok":true,"capabilities":["runtime_diagnosis"]}')
    request(peer)
    result = peer.conn.written[0]
    assert result["requestId"] == "a" * 32
    assert result["type"] == "runtime_diagnosis_result"
    assert result["report"]["host"] == "python-agent"
    assert all(item["state"] == "registered" for item in result["report"]["plugins"])
    assert peer._failures == 0


def test_invalid_requests_and_closed_negotiation_do_not_publish():
    peer = link()
    peer._state_reply(b'{"v":1,"type":"ack","ok":true,"capabilities":["runtime_diagnosis"]}')
    for change in ({"v": True}, {"service": "other"}, {"requestId": "private path"}, {"type": "unknown"}):
        request(peer, **change)
    assert peer.conn.written == []
    peer.close()
    peer.conn = Connection()
    request(peer)
    assert peer.conn.written == []


def test_private_callback_failure_is_reported_without_its_error():
    peer = link()
    def fail(): raise RuntimeError("private-password")
    peer.runtime_report = fail
    peer._state_reply(b'{"v":1,"type":"ack","ok":true,"capabilities":["runtime_diagnosis"]}')
    request(peer)
    report = peer.conn.written[0]["report"]
    assert report["state"] == "unavailable"
    assert "private" not in json.dumps(report)


def test_default_poll_loop_wait_uses_the_owned_publisher(monkeypatch):
    waits = []
    def wait(self, seconds):
        waits.append(seconds)
        raise KeyboardInterrupt()
    monkeypatch.setattr(poller.LinkSet, "wait", wait)
    runtime = poller.create_poller({"FUTU_INTERVAL": "23", "ODK_FUTU_SOCKET": "/tmp/odk-fixture-unbound.sock"})
    runtime.run()
    assert waits == [0.05]
    assert all(item["state"] == "stopped" for item in runtime.catalog())


def test_wait_isolates_a_peer_that_closes_before_its_diagnosis_response():
    import socket
    broken = link()
    healthy = link()
    local_bad, remote_bad = socket.socketpair()
    local_good, remote_good = socket.socketpair()
    broken.conn = local_bad
    healthy.conn = local_good
    broken._runtime_negotiated = healthy._runtime_negotiated = True
    packet = poller.frame({"v": 1, "type": "runtime_diagnosis", "service": "futu-poller", "requestId": "a" * 32})
    try:
        remote_bad.sendall(packet)
        remote_bad.close()
        remote_good.sendall(packet)
        publisher = poller.LinkSet([broken, healthy], "futu-poller")
        publisher.wait(0.05)
        assert broken.conn is None
        remote_good.settimeout(1)
        assert json.loads(remote_good.recv(65536))["type"] == "runtime_diagnosis_result"
        assert healthy.conn is local_good
    finally:
        for connection in (local_bad, remote_bad, local_good, remote_good):
            connection.close()


def test_diagnosis_processing_does_not_restart_the_publication_interval(monkeypatch):
    peer = link()
    peer._runtime_negotiated = True
    clock = [0.0]
    waits = []
    deadlines = []
    monkeypatch.setattr(poller.time, "monotonic", lambda: clock[0])
    def select(readers, _write, _errors, timeout):
        waits.append(timeout)
        if len(waits) == 1:
            clock[0] = 2.0
            return readers, [], []
        clock[0] += timeout
        return [], [], []
    def receive(deadline=None):
        deadlines.append(deadline)
        clock[0] = 3.0
        return True
    monkeypatch.setattr(poller.select, "select", select)
    monkeypatch.setattr(peer, "_read_replies", receive)
    poller.LinkSet([peer], "futu-poller").wait(10)
    assert waits == [10.0, 7.0]
    assert deadlines == [2.0 + poller.REPLY_TIMEOUT]
    assert clock[0] == 10.0
