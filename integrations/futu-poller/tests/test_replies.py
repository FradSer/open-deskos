"""A desk answers every record, and the poller must hear it.

A refusal the desk states (a malformed record, an unknown service) used to look
exactly like a healthy link, because nothing read the answers: an operator saw a
connected plugin and a desk that displayed nothing, and the unread answers piled
up in the socket until the desk's writes blocked.
"""

import io
import json
import os
import socket
import sys
import tempfile
import threading
import time

import poller


class FakeDesk:
    """One desk: reads records and answers them, the way the shell does."""

    def __init__(self, answers):
        self.answers = list(answers)
        self.received = []
        self._ready = threading.Event()
        self._thread = None
        self._conn = None
        self.address = None

    def drop(self):
        """The desk's side goes away, as an idle flow on a network path does."""
        conn, self._conn = self._conn, None
        if conn is not None:
            try:
                conn.close()
            except OSError:
                pass
        time.sleep(0.05)

    def __enter__(self):
        self._dir = tempfile.mkdtemp(prefix="futu-replies-")
        self.address = os.path.join(self._dir, "desk.sock")
        self._server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self._server.bind(self.address)
        self._server.listen(1)
        self._thread = threading.Thread(target=self._serve, daemon=True)
        self._thread.start()
        self._ready.wait(timeout=5)
        return self

    def __exit__(self, *_exc):
        try:
            self._server.close()
        except OSError:
            pass
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _serve(self):
        self._ready.set()
        try:
            conn, _ = self._server.accept()
        except OSError:
            return
        self._conn = conn
        with conn:
            conn.settimeout(5)
            buffer = b""
            pending = list(self.answers)
            while True:
                try:
                    chunk = conn.recv(4096)
                except (socket.timeout, OSError):
                    return
                if not chunk:
                    return
                buffer += chunk
                while b"\n" in buffer:
                    line, buffer = buffer.split(b"\n", 1)
                    if not line.strip():
                        continue
                    self.received.append(json.loads(line.decode("utf-8")))
                    answer = pending.pop(0) if pending else {"v": 1, "type": "ack", "ok": True}
                    conn.sendall((json.dumps(answer) + "\n").encode("utf-8"))


def link_for(desk, label="handheld"):
    target = poller.Target(endpoint=desk.address, parsed=poller.parse_endpoint(desk.address), label=label)
    return poller.ShellLink(target, "futu-poller", "dev")


def record():
    return {"v": 1, "service": "futu-poller", "type": "data", "snapshot": {"positions": [], "totals": {}}, "updatedAt": 1}


def test_a_refusal_from_the_desk_is_stated_once_and_the_link_stays_usable(capsys):
    answers = [
        {"v": 1, "type": "ack", "ok": True},
        {"v": 1, "type": "ack", "ok": False, "error": "malformed-record"},
        {"v": 1, "type": "ack", "ok": False, "error": "malformed-record"},
        {"v": 1, "type": "ack", "ok": True},
    ]
    with FakeDesk(answers) as desk:
        link = link_for(desk)
        assert link.ensure() is True
        assert link.send(record()) is True
        first = capsys.readouterr().err
        assert "malformed-record" in first, "the desk's own reason is the point"
        assert "handheld" in first, "and it names which desk said it"

        # The same refusal twice is one line: a desk that refuses every poll must
        # not fill the journal with it.
        assert link.send(record()) is True
        second = capsys.readouterr().err
        assert second == "", second

        # A refusal is an answer, not a dead peer: the link keeps working.
        assert link.send(record()) is True
        link.close()


def test_a_healthy_desk_says_nothing(capsys):
    with FakeDesk([]) as desk:
        link = link_for(desk)
        assert link.ensure() is True
        assert link.send(record()) is True
        assert link.send(record()) is True
        assert capsys.readouterr().err == ""
        link.close()


def test_the_poller_does_not_accumulate_unread_answers(capsys):
    # Twenty accepted records: if nothing reads them they sit in this socket
    # forever, which is what filled the buffer on the reference host.
    with FakeDesk([]) as desk:
        link = link_for(desk)
        assert link.ensure() is True
        for _ in range(20):
            assert link.send(record()) is True
        buffered = link.conn.recv(4096, socket.MSG_PEEK if hasattr(socket, "MSG_PEEK") else 0)
        assert buffered == b"", "every answer the desk sent should already be read"
        assert capsys.readouterr().err == ""
        link.close()

def test_a_persistent_failure_is_stated_once_and_a_recovery_resets_it(capsys):
    """A dropped idle flow reconnects, so one failure is routine work.

    Reporting every dropped flow would train an operator to ignore the log, which
    is the opposite of what a log is for. The rule is counted rather than timed,
    so it is asserted the same way: a Unix socket can accept a write after its
    peer has gone, which makes a socket-level version of this test tell you about
    the kernel rather than about the rule.
    """
    with FakeDesk([]) as desk:
        link = link_for(desk)

    for _ in range(poller.FAILURE_ALERT_AFTER - 1):
        link._note_failure("send failed: broken pipe")
    assert capsys.readouterr().err == "", "one or two reconnects are ordinary"

    link._note_failure("send failed: broken pipe")
    warned = capsys.readouterr().err
    assert "cannot keep a connection:" in warned, warned
    assert "handheld" in warned, "a persistent failure names the desk it is about"

    # The same failure keeps quiet, and a recovered link resets the count: a desk
    # that is being fed must not carry a failure from an hour ago.
    link._note_failure("send failed: broken pipe")
    assert capsys.readouterr().err == ""
    link._failures = 0
    link._note_failure("send failed: broken pipe")
    assert capsys.readouterr().err == "", "a recovery means the next failure counts from one"


class ResetConn:
    """A connection the desk reset: writes land, the next read does not."""

    def __init__(self):
        self.written = []

    def gettimeout(self):
        return 10

    def settimeout(self, _timeout):
        pass

    def sendall(self, data):
        self.written.append(data)

    def recv(self, _n):
        raise ConnectionResetError(104, "Connection reset by peer")


class SilentConn:
    """A connection to a desk that says nothing back, which is a healthy link."""

    def __init__(self):
        self.written = []

    def gettimeout(self):
        return 10

    def settimeout(self, _timeout):
        pass

    def sendall(self, data):
        self.written.append(data)

    def recv(self, _n):
        raise socket.timeout()


def stub_link(name, conn):
    target = poller.Target(endpoint="/tmp/%s.sock" % name, parsed=poller.parse_endpoint("/tmp/%s.sock" % name), label=name)
    link = poller.ShellLink(target, "futu-poller", "dev")
    link.conn = conn
    return link


def test_a_reset_desk_does_not_stop_the_others(capsys):
    """One desk's dead connection is one unavailable desk.

    The poller fans one record out to every configured desk, and a fan-out that
    aborts on the first failure silently stops feeding the desks that were fine:
    the record never reaches them and the failure surfaces as a crash rather than
    as the one desk that dropped. The failure is counted on the desk that had it,
    so the run has to keep going long enough for the count to be the news.
    """
    reset = stub_link("reset", ResetConn())
    healthy = stub_link("healthy", SilentConn())
    links = poller.LinkSet([reset, healthy], "futu-poller", stdout=io.StringIO())

    for _ in range(poller.FAILURE_ALERT_AFTER):
        links.send(record())
        reset.conn = ResetConn()  # the next attempt reconnects onto a desk that resets again

    assert healthy._failures == 0, "a healthy desk carries no failure"
    assert capsys.readouterr().err.count("reset: cannot keep a connection") == 1, (
        "the persistent failure is stated once, and it names the desk it is about"
    )


def test_the_healthy_desk_still_receives_every_publish():
    """The desk that is fine is fed on every poll, including the ones that fail."""
    reset = stub_link("reset", ResetConn())
    healthy = stub_link("healthy", SilentConn())
    links = poller.LinkSet([reset, healthy], "futu-poller", stdout=io.StringIO())

    for _ in range(3):
        links.send(record())
        reset.conn = ResetConn()

    assert len(healthy.conn.written) == 3, "one unreachable desk must not starve the others"


def test_reading_a_reset_desk_is_reported_not_raised(capsys):
    """A read that fails is a connection to drop, not an exception to propagate.

    The failure path closes the connection before the read loop's finally clause
    restores the timeout, so the restore has to act on the connection it started
    with rather than on whatever the field holds afterwards.
    """
    link = stub_link("reset", ResetConn())
    try:
        link._read_replies()
    except Exception as exc:  # noqa: BLE001 - the point of the test
        raise AssertionError("a dropped desk raised %s: %s" % (type(exc).__name__, exc)) from exc
    assert link.conn is None, "the dead connection is released so the next attempt reconnects"
    assert link._failures == 1, "the failure is recorded on the desk it happened to"
