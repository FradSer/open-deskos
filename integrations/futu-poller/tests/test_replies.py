"""A desk answers every record, and the poller must hear it.

A refusal the desk states (a malformed record, an unknown service) used to look
exactly like a healthy link, because nothing read the answers: an operator saw a
connected plugin and a desk that displayed nothing, and the unread answers piled
up in the socket until the desk's writes blocked.
"""

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
