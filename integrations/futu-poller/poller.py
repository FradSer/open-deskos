#!/usr/bin/env python3
"""Futu holdings poller: a Service Plugin instance for Open DeskOS.

Reads real positions from the pre-existing FutuOpenD gateway over the LAN and
publishes bounded snapshots to one or more DeskOS shells over a runtime channel
(protocol v1, see runtime/linux/docs/adr/0009-service-plugin-contract.md).

The transport is an endpoint, not a Unix socket path, so the same poller can
feed the reference desk and a second handheld without any platform-specific
code. The endpoint forms are:

  /run/user/1000/open-deskos/futu-poller.sock   a Unix socket (ownership is the
                                                authentication; no token)
  \\\\.\\pipe\\open-deskos-futu-poller            a Windows named pipe (token)
  tcp://100.82.50.70:8790                       a network address (token)

A token is read from the file a target names (``tokenFile``) or from
``ODK_CHANNEL_TOKEN_FILE``, trimmed, and refused when absent or empty; it is
sent as the connection's first line exactly as the desk's local-channel
handshake expects. A Unix socket keeps the handshake off, because the desk
still accepts a client that omits it.

Secrets arrive only from the environment (later: the system vault). They are
never printed, logged, or placed in the package.

  FUTU_HOST          gateway address (default 10.10.0.195)
  FUTU_PORT          gateway API port (default 11111)
  FUTU_RSA_FILE      client copy of the gateway RSA private key
  FUTU_TRADE_PWD     trade unlock password (positions require unlock)
  FUTU_INTERVAL      poll interval seconds (default 60)
  ODESK_FUTU_TARGETS_FILE      JSON file listing the desks to feed
                               (default ~/.config/open-deskos/futu-targets.json)
  ODESK_FUTU_SOCKET            single-target shell socket path, declared once in
                               runtime.env (absolute); used when no targets file
  ODK_CHANNEL_TOKEN_FILE       default token file for pipe/tcp targets
  ODESK_FUTU_SERVICE_REVISION  package revision the shell expects (default dev)
  SERVICE_ID         service identity (default futu-poller)
"""

import dataclasses
import json
import os
import re
import socket
import sys
import time
import urllib.parse

PROTO_VERSION = 1
MAX_POSITIONS = 64
# One answer is a short line. The cap and the timeout keep a chatty or hostile
# peer from growing this process or from stalling the poll loop.
MAX_REPLY_BYTES = 4096
REPLY_TIMEOUT = 0.2
# A network path can drop an idle flow, and reconnecting is routine work rather
# than news: reporting every dropped flow would train an operator to ignore the
# log. A failure is stated once it has persisted this many consecutive attempts.
FAILURE_ALERT_AFTER = 3

# A connect attempt is what stops a dead desk from holding up the poll: the
# timeout bounds that attempt, and every target owns its own connection, so a
# failure on one never resets or delays the others.
CONNECT_TIMEOUT = 10

TARGETS_ENV = "ODESK_FUTU_TARGETS_FILE"
DEFAULT_TARGETS_FILE = "~/.config/open-deskos/futu-targets.json"
TOKEN_ENV = "ODK_CHANNEL_TOKEN_FILE"

# The desk's own rule: a Windows named pipe has no owner, mode, or uid, so it
# is authenticated by a token. Matches runtime/linux/src/local-channel.js.
PIPE_PATTERN = re.compile(r"^\\\\.\\pipe\\", re.IGNORECASE)


def frame(record):
    return (json.dumps(record) + "\n").encode("utf-8")


def handshake_frame(token):
    """The first line of the channel, byte for byte as the desk writes it.

    ``json.dumps`` must be compact to match ``JSON.stringify``: the desk parses
    this line, but a shared line that differs is a drift no one needs.
    """
    return (json.dumps({"v": 1, "token": token}, separators=(",", ":")) + "\n").encode("utf-8")


@dataclasses.dataclass
class Endpoint:
    raw: str
    kind: str = "unix"
    address: str = ""
    host: str = ""
    port: int = 0

    @property
    def requires_token(self):
        return self.kind in ("pipe", "tcp")


@dataclasses.dataclass
class Target:
    endpoint: str
    parsed: Endpoint
    label: str = "target"
    token_file: str = ""


def parse_endpoint(raw):
    """Classify an endpoint, or raise ValueError with the reason to refuse it."""
    value = (raw or "").strip()
    if not value:
        raise ValueError("endpoint must be a non-empty string")
    if "://" in value:
        scheme = value.split("://", 1)[0].lower()
        if scheme != "tcp":
            raise ValueError("endpoint scheme %s:// is not supported" % scheme)
        return _parse_tcp(value)
    if PIPE_PATTERN.match(value):
        return Endpoint(raw=value, kind="pipe", address=value)
    return Endpoint(raw=value, kind="unix", address=value)


def _parse_tcp(value):
    try:
        parts = urllib.parse.urlsplit(value)
        host = parts.hostname
        port = parts.port
    except ValueError as exc:
        raise ValueError("endpoint %s is not a valid tcp address: %s" % (value, exc))
    if not host or port is None:
        raise ValueError("endpoint %s must be tcp://<host>:<port>" % value)
    if not 1 <= port <= 65535:
        raise ValueError("endpoint %s has an out-of-range port" % value)
    if parts.path or parts.query or parts.fragment:
        raise ValueError("endpoint %s must be tcp://<host>:<port>" % value)
    return Endpoint(raw=value, kind="tcp", host=host, port=port)


def read_token_file(path):
    """Return the token in a file, trimmed. An empty file yields an empty token."""
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read().strip()


class PipeConnection:
    """A Windows named pipe with the write-only surface a ShellLink needs.

    Python has no socket type for named pipes, so the pipe is a file. A desk does
    answer every record, but a pipe file offers no timeout to read an answer
    with, so this path stays write-only and its refusals are stated nowhere. A
    pipe endpoint is the same-machine case, where the desk and the plugin share
    a log; a remote desk is reached over tcp, which is readable.
    """

    def __init__(self, path):
        self.path = path
        self.stream = open(path, "r+b")

    def settimeout(self, _timeout):
        # A pipe opened as a file carries no socket timeout; opening is the only
        # blocking step, and it fails fast when nothing is listening.
        pass

    def sendall(self, data):
        # A named pipe can complete a partial write, so keep writing until every
        # byte is handed over before flushing.
        view = memoryview(data)
        while view:
            written = self.stream.write(view)
            if not written:
                raise OSError("short write to named pipe %s" % self.path)
            view = view[written:]
        self.stream.flush()

    def close(self):
        self.stream.close()


def open_connection(endpoint):
    if endpoint.kind == "tcp":
        return socket.create_connection((endpoint.host, endpoint.port),
                                        timeout=CONNECT_TIMEOUT)
    if endpoint.kind == "pipe":
        return PipeConnection(endpoint.address)
    conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    conn.settimeout(CONNECT_TIMEOUT)
    try:
        conn.connect(endpoint.address)
    except OSError:
        conn.close()
        raise
    return conn


def close_quietly(conn):
    try:
        conn.close()
    except Exception:
        pass


class ShellLink:
    """One desk: its own connection, its own reconnect state, its own token."""

    def __init__(self, target, service, revision):
        self.target = target
        self.endpoint = target.parsed
        self.service = service
        self.revision = revision
        self.conn = None
        self._last_reason = None
        self._replies = b""
        self._failures = 0

    def ensure(self):
        if self.conn is not None:
            return True
        token = None
        if self.endpoint.requires_token:
            token = self._token()
            if token is None:
                return False
        conn = None
        try:
            conn = open_connection(self.endpoint)
            if token is not None:
                conn.sendall(handshake_frame(token))
            conn.sendall(frame({
                "v": 1, "type": "hello", "service": self.service,
                "revision": self.revision, "proto": PROTO_VERSION,
            }))
        except OSError as exc:
            if conn is not None:
                close_quietly(conn)
            self._note_failure("cannot reach endpoint: %s" % exc)
            return False
        self.conn = conn
        self._last_reason = None
        return True

    def send(self, record):
        try:
            if not self.ensure():
                return False
            self.conn.sendall(frame(record))
            self._read_replies()
            self._failures = 0
            return True
        except OSError as exc:
            self._note_failure("send failed: %s" % exc)
            self.close()
            return False

    def _note_failure(self, reason):
        """Count consecutive failures, and state only one that persists.

        A dropped idle flow reconnects on the next attempt, so a single failure
        is routine work. The same failure three times running means the desk is
        not being fed, which is the thing an operator needs to see. The count is
        deliberately not in the message: a count in it would make every further
        failure look like new news, and the whole point is to be quiet until the
        situation changes. A successful connection clears the reason, so the same
        failure is stated again after a recovery.
        """
        self._failures += 1
        if self._failures < FAILURE_ALERT_AFTER:
            return
        self._warn_once("cannot keep a connection: %s" % reason)

    def close(self):
        if self.conn is not None:
            close_quietly(self.conn)
        self.conn = None

    def _read_replies(self):
        """Read what the desk answered, so its own words are the reason shown.

        The desk answers every record with one short line. Nothing used to read
        them: a refusal (a malformed record, an unknown service) looked exactly
        like a healthy link, and the answers piled up in this socket until the
        desk's writes blocked and the next send failed with a broken pipe. A
        named pipe cannot be read with a timeout, so it keeps the write-only
        path. Reading never blocks the poll loop: one short timeout bounds it.
        """
        if not hasattr(self.conn, "recv"):
            return
        previous = None
        try:
            previous = self.conn.gettimeout()
        except OSError:
            previous = None
        try:
            self.conn.settimeout(REPLY_TIMEOUT)
            while True:
                try:
                    chunk = self.conn.recv(4096)
                except socket.timeout:
                    return
                except OSError as exc:
                    self._note_failure("cannot read the desk's answer: %s" % exc)
                    self.close()
                    return
                if not chunk:
                    return
                self._replies += chunk
                if len(self._replies) > MAX_REPLY_BYTES:
                    # A peer that never sends a newline must not grow this buffer.
                    self._replies = self._replies[-MAX_REPLY_BYTES:]
                while b"\n" in self._replies:
                    line, self._replies = self._replies.split(b"\n", 1)
                    self._state_reply(line)
        finally:
            if previous is not None:
                try:
                    self.conn.settimeout(previous)
                except OSError:
                    pass

    def _state_reply(self, line):
        if not line.strip():
            return
        try:
            reply = json.loads(line.decode("utf-8", "replace"))
        except ValueError:
            return
        if not isinstance(reply, dict) or reply.get("ok") is not False:
            return
        # The desk's own error is the only thing that explains a desk which is
        # connected and shows nothing, so it is what the warning carries.
        self._warn_once("desk refused a record: %s" % (reply.get("error") or "refused"))

    def _token(self):
        path = self.target.token_file
        if not path:
            self._warn_once("endpoint requires a token: set tokenFile or %s" % TOKEN_ENV)
            return None
        try:
            token = read_token_file(path)
        except OSError as exc:
            self._warn_once("cannot read token file %s: %s" % (path, exc))
            return None
        if not token:
            self._warn_once("token file %s is empty" % path)
            return None
        return token

    def _warn_once(self, reason):
        # A dead desk is re-probed every interval; the log states the first
        # reason and stays quiet until the reason changes.
        message = "%s: %s" % (self.target.label, reason)
        if message == self._last_reason:
            return
        self._last_reason = message
        _warn(message)


class LinkSet:
    """Fan one record out to every configured desk, or to stdout when none is."""

    def __init__(self, links, service, stdout=None):
        self.links = links
        self.service = service
        self.stdout = stdout if stdout is not None else sys.stdout

    def send(self, record):
        record.update({"v": 1, "service": self.service})
        if not self.links:
            self.stdout.write(json.dumps(record) + "\n")
            self.stdout.flush()
            return
        for link in self.links:
            link.send(record)

    def close(self):
        for link in self.links:
            link.close()


def _warn(message):
    sys.stderr.write("futu-poller: %s\n" % message)
    sys.stderr.flush()


def load_targets(env=None, warn=None):
    """Return the configured desks, refusing a malformed one without stopping.

    A targets file wins over the single-target environment form; when there is
    no file, ``ODESK_FUTU_SOCKET`` keeps the reference host working exactly as
    it does today.
    """
    env = os.environ if env is None else env
    warn = warn or _warn
    path = env.get(TARGETS_ENV, "").strip()
    explicit = bool(path)
    if not path:
        path = os.path.expanduser(DEFAULT_TARGETS_FILE)
    if os.path.exists(path):
        return _targets_from_file(path, env, warn)
    if explicit:
        warn("targets file %s does not exist" % path)

    single = env.get("ODESK_FUTU_SOCKET", "").strip()
    if not single:
        return []
    try:
        parsed = parse_endpoint(single)
    except ValueError as exc:
        warn("refusing ODESK_FUTU_SOCKET: %s" % exc)
        return []
    return [Target(endpoint=single, parsed=parsed, label="ODESK_FUTU_SOCKET")]


def _targets_from_file(path, env, warn):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError) as exc:
        warn("refusing targets file %s: %s" % (path, exc))
        return []
    if not isinstance(document, dict) or not isinstance(document.get("targets"), list):
        warn('refusing targets file %s: expected {"targets": [...]}' % path)
        return []

    default_token_file = env.get(TOKEN_ENV, "").strip()
    targets = []
    for index, entry in enumerate(document["targets"]):
        try:
            targets.append(_target_from_entry(entry, index, default_token_file))
        except ValueError as exc:
            warn("refusing %s: %s" % (_entry_label(entry, index), exc))
    return targets


def _target_from_entry(entry, index, default_token_file):
    if not isinstance(entry, dict):
        raise ValueError("expected a target object")
    endpoint = entry.get("endpoint")
    if not isinstance(endpoint, str) or not endpoint.strip():
        raise ValueError("endpoint must be a non-empty string")
    endpoint = endpoint.strip()
    parsed = parse_endpoint(endpoint)

    token_file = entry.get("tokenFile", "")
    if token_file is None:
        token_file = ""
    if not isinstance(token_file, str):
        raise ValueError("tokenFile must be a string")
    token_file = token_file.strip() or default_token_file
    if parsed.requires_token and not token_file:
        raise ValueError("endpoint %s requires a token: set tokenFile or %s"
                         % (endpoint, TOKEN_ENV))

    name = entry.get("name")
    label = name.strip() if isinstance(name, str) and name.strip() else "target[%d]" % index
    return Target(endpoint=endpoint, parsed=parsed, label=label, token_file=token_file)


def _entry_label(entry, index):
    if isinstance(entry, dict):
        name = entry.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
        endpoint = entry.get("endpoint")
        if isinstance(endpoint, str) and endpoint.strip():
            return "target[%d] %s" % (index, endpoint.strip())
    return "target[%d]" % index


def create_links(env=None, service="futu-poller", revision="dev", warn=None):
    return [ShellLink(target, service, revision)
            for target in load_targets(env, warn)]


def snapshot_from_frames(position_frames, fund_frames):
    positions = []
    seen = set()
    for entry in position_frames:
        code = str(entry.get("code", ""))
        if not code or code in seen:
            continue
        seen.add(code)
        positions.append({
            "code": code,
            "name": str(entry.get("stock_name", "")),
            "market": str(entry.get("market", "")),
            "qty": float(entry.get("qty", 0) or 0),
            "cost": float(entry.get("cost_price", 0) or 0),
            "price": float(entry.get("nominal_price", 0) or 0),
            "marketVal": float(entry.get("market_val", 0) or 0),
            "plVal": float(entry.get("pl_val", 0) or 0),
            "plRatio": float(entry.get("pl_ratio", 0) or 0),
            "dayPlVal": float(entry.get("today_pl_val", 0) or 0),
            "currency": str(entry.get("currency", "") or "").upper(),
        })
    positions.sort(key=lambda p: abs(p["marketVal"]), reverse=True)
    positions = positions[:MAX_POSITIONS]
    for p in positions:
        base = p["marketVal"] - p["dayPlVal"]
        p["dayRatio"] = (p["dayPlVal"] / base) if base else 0.0
    # Today ratio: the day's profit over yesterday's base. It freezes at close,
    # so a closed market honestly reports the finished session.
    day_pl = sum(p["dayPlVal"] for p in positions)
    day_base = sum(p["marketVal"] - p["dayPlVal"] for p in positions)
    day_by_ccy = {}
    for p in positions:
        day_by_ccy[p["currency"] or "?"] = day_by_ccy.get(p["currency"] or "?", 0.0) + p["dayPlVal"]
    totals = {
        "marketVal": sum(p["marketVal"] for p in positions),
        "plVal": sum(p["plVal"] for p in positions),
        "cash": sum(float(f.get("cash", 0) or 0) for f in fund_frames),
        "dayPlVal": day_pl,
        "dayByCcy": day_by_ccy,
        "plRatio": (day_pl / day_base) if day_base else 0.0,
    }
    return {"positions": positions, "totals": totals}


def poll_once(trade_contexts):
    position_frames, fund_frames = [], []
    for ctx in trade_contexts:
        ret, data = ctx.position_list_query()
        if ret != 0:
            raise RuntimeError("position_list_query failed: %s" % data)
        position_frames.extend(data.to_dict(orient="records"))
        ret, funds = ctx.accinfo_query()
        if ret != 0:
            raise RuntimeError("accinfo_query failed: %s" % funds)
        fund_frames.extend(funds.to_dict(orient="records"))
    return snapshot_from_frames(position_frames, fund_frames)


def main():
    host = os.environ.get("FUTU_HOST", "10.10.0.195")
    port = int(os.environ.get("FUTU_PORT", "11111"))
    rsa_file = os.environ.get("FUTU_RSA_FILE", "")
    trade_pwd = os.environ.get("FUTU_TRADE_PWD", "")
    interval = int(os.environ.get("FUTU_INTERVAL", "60"))
    service = os.environ.get("SERVICE_ID", "futu-poller")
    revision = os.environ.get("ODESK_FUTU_SERVICE_REVISION", "dev")

    links = LinkSet(create_links(os.environ, service, revision, _warn), service)
    contexts = []

    if not trade_pwd:
        try:
            while True:
                links.send({"type": "auth-required",
                            "secrets": ["futu-trade-password"]})
                time.sleep(interval)
        except KeyboardInterrupt:
            pass
        finally:
            links.close()
        return

    from futu import (OpenSecTradeContext, RET_OK, SecurityFirm,
                      SysConfig, TrdMarket)

    if rsa_file:
        SysConfig.enable_proto_encrypt(True)
        SysConfig.set_init_rsa_file(rsa_file)

    def open_contexts():
        for market in (TrdMarket.HK, TrdMarket.US):
            ctx = OpenSecTradeContext(filter_trdmarket=market, host=host,
                                      port=port, security_firm=SecurityFirm.FUTUSECURITIES)
            contexts.append(ctx)

    try:
        open_contexts()
        while True:
            try:
                for ctx in contexts:
                    ret, _ = ctx.unlock_trade(trade_pwd)
                    if ret != RET_OK:
                        raise RuntimeError("unlock_trade rejected")
                snapshot = poll_once(contexts)
                snapshot["updatedAt"] = int(time.time() * 1000)
                links.send({"type": "data", "snapshot": snapshot})
            except Exception as exc:  # noqa: BLE001 - poller must never die
                links.send({"type": "error", "code": "poll-failed",
                            "message": "%s: %s" % (type(exc).__name__, exc)})
            time.sleep(interval)
    except KeyboardInterrupt:
        pass
    finally:
        for ctx in contexts:
            try:
                ctx.close()
            except Exception:
                pass
        links.close()


if __name__ == "__main__":
    main()