"""Transport tests for the Futu poller.

They drive the real client (``poller.py``) against a socket server started in
the test: a temp Unix socket and a loopback TCP port. No gateway and no futu
SDK are involved, so the whole file is stdlib-only.

Given a target endpoint, the poller connects, presents the shared channel
handshake when the endpoint cannot be authenticated by filesystem ownership,
then pushes the protocol v1 records. Every target owns its connection, so one
unreachable desk never takes the others down.
"""

import json
import os
import pathlib
import shutil
import socket
import tempfile
import threading
import time

import pytest

import poller

SERVICE = "futu-poller"
REVISION = "r1-test"
DATA = {"type": "data", "snapshot": {"positions": [], "totals": {}}, "updatedAt": 1}


@pytest.fixture
def socket_dir():
    # A Unix socket path is length-limited, and pytest's tmp_path is long, so
    # sockets live in a short directory of their own.
    base = "/tmp" if os.path.isdir("/tmp") else tempfile.gettempdir()
    directory = tempfile.mkdtemp(prefix="odk-t-", dir=base)
    yield pathlib.Path(directory)
    shutil.rmtree(directory, ignore_errors=True)


class LineServer:
    """A stand-in desk: accepts connections and records the JSON lines sent."""

    def __init__(self, listener):
        self.listener = listener
        self.lines = []
        self.connections = 0
        self._condition = threading.Condition()
        self._stop = threading.Event()
        self._sockets = []
        self._readers = []
        self._accept_thread = threading.Thread(target=self._accept_loop, daemon=True)
        self._accept_thread.start()

    def _accept_loop(self):
        self.listener.settimeout(0.1)
        while not self._stop.is_set():
            try:
                conn, _ = self.listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            with self._condition:
                self.connections += 1
            self._sockets.append(conn)
            reader = threading.Thread(target=self._read, args=(conn,), daemon=True)
            reader.start()
            self._readers.append(reader)

    def _read(self, conn):
        conn.settimeout(0.1)
        buffer = b""
        while not self._stop.is_set():
            try:
                chunk = conn.recv(65536)
            except socket.timeout:
                continue
            except OSError:
                break
            if not chunk:
                break
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                with self._condition:
                    self.lines.append(line.decode("utf-8"))
                    self._condition.notify_all()
        try:
            conn.close()
        except OSError:
            pass

    def wait_for(self, count, timeout=5.0):
        deadline = time.monotonic() + timeout
        with self._condition:
            while len(self.lines) < count:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return False
                self._condition.wait(remaining)
            return True

    def snapshot(self):
        with self._condition:
            return list(self.lines)

    def close(self):
        self._stop.set()
        try:
            self.listener.close()
        except OSError:
            pass
        for conn in list(self._sockets):
            try:
                conn.close()
            except OSError:
                pass
        self._accept_thread.join(timeout=2)
        for reader in list(self._readers):
            reader.join(timeout=2)


def unix_server(path):
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(str(path))
    listener.listen(8)
    return LineServer(listener)


def tcp_server():
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(8)
    return LineServer(listener), listener.getsockname()[1]


def isolate_home(monkeypatch, tmp_path):
    """Point the default targets file at an empty home and clear the env form."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    for name in ("ODESK_FUTU_SOCKET", "ODESK_FUTU_TARGETS_FILE", "ODK_CHANNEL_TOKEN_FILE"):
        monkeypatch.delenv(name, raising=False)


def write_targets(tmp_path, targets):
    path = tmp_path / "futu-targets.json"
    path.write_text(json.dumps({"targets": targets}), encoding="utf-8")
    return str(path)


def links_from_env(env=None):
    return poller.LinkSet(
        poller.create_links(os.environ if env is None else env, SERVICE, REVISION),
        SERVICE,
    )


def test_a_unix_socket_target_sends_hello_without_a_handshake(monkeypatch, tmp_path, socket_dir):
    isolate_home(monkeypatch, tmp_path)
    socket_path = socket_dir / "futu-poller.sock"
    server = unix_server(socket_path)
    monkeypatch.setenv("ODESK_FUTU_SOCKET", str(socket_path))

    links = links_from_env()
    assert len(links.links) == 1
    assert links.links[0].endpoint.kind == "unix"

    links.send(dict(DATA))
    assert server.wait_for(2), server.snapshot()
    lines = server.snapshot()
    server.close()

    hello = json.loads(lines[0])
    assert hello == {"v": 1, "type": "hello", "service": SERVICE,
                     "revision": REVISION, "proto": 1}
    assert json.loads(lines[1])["type"] == "data"
    assert all("token" not in json.loads(line) for line in lines), \
        "a Unix socket is authenticated by ownership, so no handshake line is sent"


def test_a_tcp_target_sends_the_handshake_before_hello(monkeypatch, tmp_path):
    isolate_home(monkeypatch, tmp_path)
    server, port = tcp_server()
    token_file = tmp_path / "handheld-channel.token"
    token_file.write_text("handheld-secret\n", encoding="utf-8")
    targets_file = write_targets(tmp_path, [
        {"name": "handheld", "endpoint": "tcp://127.0.0.1:%d" % port,
         "tokenFile": str(token_file)},
    ])
    monkeypatch.setenv("ODESK_FUTU_TARGETS_FILE", targets_file)

    links = links_from_env()
    assert len(links.links) == 1
    links.send(dict(DATA))
    assert server.wait_for(3), server.snapshot()
    lines = server.snapshot()
    server.close()

    # Byte for byte the desk's own handshakeFrame(): compact separators and
    # the same key order, so the line is identical on both sides.
    assert lines[0] == '{"v":1,"token":"handheld-secret"}'
    assert json.loads(lines[1])["type"] == "hello"


def test_a_tcp_target_falls_back_to_the_shared_token_file(monkeypatch, tmp_path):
    isolate_home(monkeypatch, tmp_path)
    server, port = tcp_server()
    token_file = tmp_path / "local-channel.token"
    token_file.write_text("shared-token\n", encoding="utf-8")
    targets_file = write_targets(tmp_path, [
        {"name": "handheld", "endpoint": "tcp://127.0.0.1:%d" % port},
    ])
    monkeypatch.setenv("ODESK_FUTU_TARGETS_FILE", targets_file)
    monkeypatch.setenv("ODK_CHANNEL_TOKEN_FILE", str(token_file))

    links = links_from_env()
    assert len(links.links) == 1
    links.send(dict(DATA))
    assert server.wait_for(3), server.snapshot()
    lines = server.snapshot()
    server.close()

    assert lines[0] == '{"v":1,"token":"shared-token"}'


def test_a_missing_token_file_is_refused_instead_of_sending_a_bad_handshake(
        monkeypatch, tmp_path, capsys):
    isolate_home(monkeypatch, tmp_path)
    server, port = tcp_server()
    missing = tmp_path / "not-created-yet.token"
    targets_file = write_targets(tmp_path, [
        {"name": "handheld", "endpoint": "tcp://127.0.0.1:%d" % port,
         "tokenFile": str(missing)},
    ])
    monkeypatch.setenv("ODESK_FUTU_TARGETS_FILE", targets_file)

    links = links_from_env()
    assert len(links.links) == 1
    links.links[0].send(dict(DATA))

    assert server.connections == 0, "nothing may reach the desk without a good token"
    assert server.snapshot() == []
    server.close()

    err = capsys.readouterr().err
    assert "handheld" in err
    assert str(missing) in err


def test_an_empty_token_file_is_refused_instead_of_sending_a_bad_handshake(
        monkeypatch, tmp_path, capsys):
    isolate_home(monkeypatch, tmp_path)
    server, port = tcp_server()
    token_file = tmp_path / "handheld-channel.token"
    token_file.write_text("  \n", encoding="utf-8")
    targets_file = write_targets(tmp_path, [
        {"name": "handheld", "endpoint": "tcp://127.0.0.1:%d" % port,
         "tokenFile": str(token_file)},
    ])
    monkeypatch.setenv("ODESK_FUTU_TARGETS_FILE", targets_file)

    links = links_from_env()
    assert len(links.links) == 1
    links.links[0].send(dict(DATA))

    assert server.connections == 0
    assert server.snapshot() == []
    server.close()

    err = capsys.readouterr().err
    assert "handheld" in err
    assert "empty" in err


def test_a_token_endpoint_with_no_token_configured_is_refused_by_name(
        monkeypatch, tmp_path, capsys):
    isolate_home(monkeypatch, tmp_path)
    targets_file = write_targets(tmp_path, [
        {"name": "handheld", "endpoint": "tcp://127.0.0.1:8790"},
    ])
    monkeypatch.setenv("ODESK_FUTU_TARGETS_FILE", targets_file)

    links = links_from_env()
    assert links.links == []
    err = capsys.readouterr().err
    assert "handheld" in err
    assert "token" in err


def test_two_targets_receive_the_same_records_and_a_refused_one_does_not_stop_them(
        monkeypatch, tmp_path, socket_dir):
    isolate_home(monkeypatch, tmp_path)
    local_path = socket_dir / "futu-poller.sock"
    local_server = unix_server(local_path)
    handheld_server, port = tcp_server()
    token_file = tmp_path / "handheld-channel.token"
    token_file.write_text("handheld-secret\n", encoding="utf-8")

    targets_file = write_targets(tmp_path, [
        # First on purpose: a refusal here must not cost the healthy desks.
        {"name": "offline", "endpoint": str(socket_dir / "nobody-listens.sock")},
        {"name": "local", "endpoint": str(local_path)},
        {"name": "handheld", "endpoint": "tcp://127.0.0.1:%d" % port,
         "tokenFile": str(token_file)},
    ])
    monkeypatch.setenv("ODESK_FUTU_TARGETS_FILE", targets_file)

    links = links_from_env()
    assert len(links.links) == 3

    for record in (dict(DATA), {"type": "data", "snapshot": {"positions": []}, "updatedAt": 2}):
        links.send(record)

    assert local_server.wait_for(3), local_server.snapshot()
    assert handheld_server.wait_for(4), handheld_server.snapshot()
    local_lines = local_server.snapshot()
    handheld_lines = handheld_server.snapshot()
    local_server.close()
    handheld_server.close()

    assert [json.loads(line)["type"] for line in local_lines] == ["hello", "data", "data"]
    assert handheld_lines[0] == '{"v":1,"token":"handheld-secret"}'
    assert [json.loads(line)["type"] for line in handheld_lines[1:]] == \
        ["hello", "data", "data"]
    assert local_lines[1] == handheld_lines[2], "both desks receive the same record"


def test_a_malformed_target_is_refused_by_name_while_the_others_run(
        monkeypatch, tmp_path, socket_dir, capsys):
    isolate_home(monkeypatch, tmp_path)
    first_path = socket_dir / "first.sock"
    second_path = socket_dir / "second.sock"
    first_server = unix_server(first_path)
    second_server = unix_server(second_path)
    targets_file = write_targets(tmp_path, [
        {"name": "first", "endpoint": str(first_path)},
        {"name": "broken", "endpoint": "udp://127.0.0.1:9999"},
        {"name": "second", "endpoint": str(second_path)},
    ])
    monkeypatch.setenv("ODESK_FUTU_TARGETS_FILE", targets_file)

    links = links_from_env()
    assert len(links.links) == 2, "the malformed entry is dropped, the others load"
    links.send(dict(DATA))

    assert first_server.wait_for(2), first_server.snapshot()
    assert second_server.wait_for(2), second_server.snapshot()
    first_server.close()
    second_server.close()

    err = capsys.readouterr().err
    assert "broken" in err


def test_a_targets_file_that_is_not_a_targets_object_is_refused(
        monkeypatch, tmp_path, capsys):
    isolate_home(monkeypatch, tmp_path)
    path = tmp_path / "futu-targets.json"
    path.write_text('{"desks": []}', encoding="utf-8")
    monkeypatch.setenv("ODESK_FUTU_TARGETS_FILE", str(path))

    links = links_from_env()
    assert links.links == []
    err = capsys.readouterr().err
    assert str(path) in err


def test_endpoint_forms_require_a_token_exactly_where_the_desk_does():
    unix = poller.parse_endpoint("/run/user/1000/open-deskos/futu-poller.sock")
    assert unix.kind == "unix" and unix.requires_token is False

    pipe = poller.parse_endpoint(r"\\.\pipe\open-deskos-futu-poller")
    assert pipe.kind == "pipe" and pipe.requires_token is True

    tcp = poller.parse_endpoint("tcp://100.82.50.70:8790")
    assert (tcp.kind, tcp.host, tcp.port) == ("tcp", "100.82.50.70", 8790)
    assert tcp.requires_token is True

    with pytest.raises(ValueError):
        poller.parse_endpoint("udp://127.0.0.1:9999")
    with pytest.raises(ValueError):
        poller.parse_endpoint("tcp://127.0.0.1")
    with pytest.raises(ValueError):
        poller.parse_endpoint("tcp://127.0.0.1:8790/path")


def test_a_named_pipe_connection_writes_every_byte_through_partial_writes():
    class PartialStream:
        def __init__(self):
            self.chunks = []
            self.flushed = False

        def write(self, view):
            chunk = bytes(view)[:2]
            self.chunks.append(chunk)
            return len(chunk)

        def flush(self):
            self.flushed = True

    conn = poller.PipeConnection.__new__(poller.PipeConnection)
    conn.path = r"\\.\pipe\open-deskos-futu-poller"
    conn.stream = PartialStream()
    conn.sendall(b"abcdef")

    assert b"".join(conn.stream.chunks) == b"abcdef"
    assert conn.stream.flushed is True


def test_with_no_target_configured_records_go_to_stdout(monkeypatch, tmp_path):
    import io

    isolate_home(monkeypatch, tmp_path)
    links = poller.LinkSet(poller.create_links(os.environ, SERVICE, REVISION),
                           SERVICE, stdout=io.StringIO())
    links.send({"type": "auth-required", "secrets": ["futu-trade-password"]})

    line = json.loads(links.stdout.getvalue().strip())
    assert line == {"type": "auth-required", "secrets": ["futu-trade-password"],
                    "v": 1, "service": SERVICE}