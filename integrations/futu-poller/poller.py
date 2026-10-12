#!/usr/bin/env python3
"""Futu holdings poller: a Service Plugin instance for Open DeskOS.

Reads real positions from the pre-existing FutuOpenD gateway over the LAN and
publishes bounded snapshots to one or more DeskOS shells over a runtime channel
(protocol v1, see runtime/shell/docs/ARCHITECTURE.md#adr-0009).

The transport is an endpoint, not a Unix socket path, so the same poller can
feed the reference desk and a second handheld without any platform-specific
code. The endpoint forms are:

  /run/user/1000/odk/futu-poller.sock   a Unix socket (ownership is the
                                                authentication; no token)
  \\\\.\\pipe\\odk-futu-poller            a Windows named pipe (token)
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
  ODK_FUTU_TARGETS_FILE      JSON file listing the desks to feed
                               (default ~/.config/odk/futu-targets.json)
  ODK_FUTU_SOCKET            single-target shell socket path, declared once in
                               runtime.env (absolute); used when no targets file
  ODK_CHANNEL_TOKEN_FILE       default token file for pipe/tcp targets
  ODK_FUTU_SERVICE_REVISION  package revision the shell expects (default dev)
  SERVICE_ID         service identity (default futu-poller)
"""

import dataclasses
import json
import os
import ntpath
import re
import socket
import select
import sys
import time
import urllib.parse
from typing import Callable, Mapping

from plugin_host import PluginContext, PluginHost, require_synchronous
from plugin_config import read_config, update_enabled, resolve_shared_disabled

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

TARGETS_ENV = "ODK_FUTU_TARGETS_FILE"
DEFAULT_TARGETS_FILE = "~/.config/odk/futu-targets.json"
TOKEN_ENV = "ODK_CHANNEL_TOKEN_FILE"
CONTROL_PORT = "odk:futu/control/v1"


def management_settings(env: Mapping[str, str], platform: str) -> tuple[str | None, str | None]:
    """Resolve the shared local management identity without reading token files."""
    endpoint = env.get("ODK_FUTU_CONTROL")
    if endpoint is None:
        if platform == "win32":
            endpoint = r"\\.\pipe\odk-futu-plugin-control"
        elif env.get("XDG_RUNTIME_DIR") and os.path.isabs(env["XDG_RUNTIME_DIR"]):
            endpoint = os.path.join(env["XDG_RUNTIME_DIR"], "odk-futu", "control.sock")
    token_file = env.get(TOKEN_ENV)
    if not token_file and platform == "win32" and env.get("LOCALAPPDATA"):
        token_file = ntpath.join(env["LOCALAPPDATA"], "odk", "local-channel.token")
    return endpoint or None, token_file or None

# The desk's own rule: a Windows named pipe has no owner, mode, or uid, so it
# is authenticated by a token. Matches runtime/shell/src/local-channel.js.
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

    def __init__(self, target, service, revision, runtime_report: Callable[[], dict] | None = None,
                 connector: Callable[[Endpoint], object] | None = None):
        self.connector = connector
        self.runtime_report = runtime_report
        self._runtime_negotiated = False
        self.target = target
        self.endpoint = target.parsed
        self.service = service
        self.revision = revision
        self.conn = None
        self._close_failure = None
        self._last_reason = None
        self._replies = b""
        self._failures = 0

    def ensure(self):
        if self._close_failure is not None:
            return False
        if self.conn is not None:
            return True
        token = None
        if self.endpoint.requires_token:
            token = self._token()
            if token is None:
                return False
        conn = None
        try:
            conn = require_synchronous((self.connector or open_connection)(self.endpoint))
            self.conn = conn
            if token is not None:
                conn.sendall(handshake_frame(token))
            hello = {"v": 1, "type": "hello", "service": self.service,
                     "revision": self.revision, "proto": PROTO_VERSION}
            if self.runtime_report is not None and hasattr(conn, "recv"):
                try:
                    if any(not callable(getattr(conn, method, None))
                           for method in ("recv", "gettimeout", "settimeout", "fileno")):
                        raise TypeError("readable transport requires socket-compatible operations")
                    select.select([conn], [], [], 0)
                except Exception:
                    try:
                        self.close()
                    except Exception:
                        pass
                    raise
                hello["capabilities"] = ["runtime_diagnosis"]
            conn.sendall(frame(hello))
        except OSError as exc:
            if conn is not None:
                try:
                    self.close()
                except Exception:
                    # Ownership and its failure remain available to plugin cleanup.
                    pass
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
            if not self._read_replies():
                # The answer never arrived because the link went away mid-record.
                # The write is not a delivery, so this poll is not a success: a
                # report of success here would clear the failure count of a desk
                # that is in fact never being fed, and the one alert that exists
                # would never be raised.
                return False
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

    def close(self) -> None:
        self._runtime_negotiated = False
        if self._close_failure is not None:
            raise self._close_failure
        if self.conn is not None:
            try:
                self.conn.close()
            except Exception as error:
                # OS close can fail after releasing the underlying handle.
                # Keep the uncertainty; a repeated close is not release evidence.
                self._close_failure = error
                raise
        self.conn = None

    def _read_replies(self, deadline: float | None = None):
        """Read what the desk answered, so its own words are the reason shown.

        The desk answers every record with one short line. Nothing used to read
        them: a refusal (a malformed record, an unknown service) looked exactly
        like a healthy link, and the answers piled up in this socket until the
        desk's writes blocked and the next send failed with a broken pipe. A
        named pipe cannot be read with a timeout, so it keeps the write-only
        path. Reading never blocks the poll loop: one short timeout bounds it.

        Returns whether the link is still usable, so a record whose answer was
        never received is not counted as delivered.
        """
        # The connection is held locally: the failure path below closes the link,
        # so the finally clause has to restore the timeout on the connection this
        # read started with rather than on whatever self.conn holds afterwards.
        conn = self.conn
        if conn is None or not hasattr(conn, "recv"):
            return True
        previous = None
        try:
            previous = conn.gettimeout()
        except OSError:
            previous = None
        try:
            conn.settimeout(REPLY_TIMEOUT)
            while True:
                if deadline is not None:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        return True
                    conn.settimeout(min(REPLY_TIMEOUT, remaining))
                try:
                    chunk = conn.recv(4096)
                except socket.timeout:
                    return True
                except OSError as exc:
                    self._note_failure("cannot read the desk's answer: %s" % exc)
                    self.close()
                    return False
                if not chunk:
                    self._note_failure("desk closed the connection")
                    self.close()
                    return False
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
                    conn.settimeout(previous)
                except OSError:
                    pass

    def _state_reply(self, line):
        if not line.strip():
            return
        try:
            reply = json.loads(line.decode("utf-8", "replace"))
        except ValueError:
            return
        if not isinstance(reply, dict):
            return
        if (type(reply.get("v")) is int and reply["v"] == 1
                and reply.get("type") == "ack" and reply.get("ok") is True
                and isinstance(reply.get("capabilities"), list)
                and "runtime_diagnosis" in reply["capabilities"]):
            self._runtime_negotiated = self.runtime_report is not None
            return
        if reply.get("type") == "runtime_diagnosis":
            if (not self._runtime_negotiated or self.conn is None
                    or type(reply.get("v")) is not int or reply["v"] != 1
                    or reply.get("service") != self.service
                    or not isinstance(reply.get("requestId"), str)
                    or re.fullmatch(r"[a-f0-9]{32}", reply["requestId"]) is None):
                return
            try:
                report = require_synchronous(self.runtime_report())
                if len(json.dumps(report, ensure_ascii=False).encode("utf-8")) > 16384:
                    raise ValueError("report exceeds limit")
            except Exception:
                report = {"host": "python-agent", "instance": "futu-poller",
                          "state": "unavailable", "reason": "report-invalid", "plugins": []}
            self.conn.sendall(frame({"v": 1, "type": "runtime_diagnosis_result",
                                     "service": self.service, "requestId": reply["requestId"], "report": report}))
            return
        if reply.get("ok") is not False:
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
        self._closed_links = set()

    def send(self, record):
        record.update({"v": 1, "service": self.service})
        if not self.links:
            self.stdout.write(json.dumps(record) + "\n")
            self.stdout.flush()
            return
        for link in self.links:
            self._closed_links.discard(id(link))
            # One desk is one desk. A failure is already recorded on the link that
            # had it, and letting it escape here would abandon the desks this
            # loop had not reached yet, so a single dead desk would stop feeding
            # every desk after it in the list.
            try:
                link.send(record)
            except Exception as exc:  # noqa: BLE001 - one desk must not end the fan-out
                _warn("%s: cannot publish: %s: %s" % (link.target.label, type(exc).__name__, exc))

    def wait(self, seconds: float) -> None:
        """Receive negotiated requests on the owner thread between publications."""
        if seconds < 0:
            raise ValueError("sleep length must be non-negative")
        def failed(link, error):
            link._note_failure("cannot receive runtime requests: %s" % error)
            try:
                link.close()
            except Exception:
                # Cleanup retains an uncertain handle for the owner host.
                pass

        deadline = time.monotonic() + seconds
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            links = [link for link in self.links
                     if link.conn is not None and hasattr(link.conn, "recv")
                     and link._runtime_negotiated and link._close_failure is None]
            if not links:
                time.sleep(remaining)
                return
            try:
                ready, _, _ = select.select([link.conn for link in links], [], [], remaining)
            except (OSError, ValueError, TypeError):
                ready = []
                for link in links:
                    try:
                        readable, _, _ = select.select([link.conn], [], [], 0)
                        ready.extend(readable)
                    except (OSError, ValueError, TypeError) as error:
                        failed(link, error)
                if not ready:
                    time.sleep(min(remaining, 0.01))
            for link in links:
                if link.conn in ready:
                    try:
                        link._read_replies(deadline=min(deadline, time.monotonic() + REPLY_TIMEOUT))
                    except Exception as error:
                        failed(link, error)

    def close(self) -> None:
        first_error = None
        for link in self.links:
            if id(link) in self._closed_links:
                continue
            try:
                link.close()
                self._closed_links.add(id(link))
            except Exception as error:
                if first_error is None:
                    first_error = error
        if first_error is not None:
            raise first_error


def _warn(message):
    sys.stderr.write("futu-poller: %s\n" % message)
    sys.stderr.flush()


def load_targets(env=None, warn=None):
    """Return the configured desks, refusing a malformed one without stopping.

    A targets file wins over the single-target environment form; when there is
    no file, ``ODK_FUTU_SOCKET`` keeps the reference host working exactly as
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

    single = env.get("ODK_FUTU_SOCKET", "").strip()
    if not single:
        return []
    try:
        parsed = parse_endpoint(single)
    except ValueError as exc:
        warn("refusing ODK_FUTU_SOCKET: %s" % exc)
        return []
    return [Target(endpoint=single, parsed=parsed, label="ODK_FUTU_SOCKET",
                   token_file=env.get(TOKEN_ENV, "").strip())]


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


PORTS = {
    "publisher": "odk:futu/publisher/v1",
    "gateway": "odk:futu/gateway/v1",
    "loop": "odk:futu/loop/v1",
    "transport": "odk:futu/transport/v1",
}


class FutuGateway:
    """One native gateway plugin owns the SDK trade contexts."""
    def __init__(self, context: PluginContext) -> None:
        self.contexts = []
        self._close_failures = {}
        settings = context.capability("futu.credentials")
        self.trade_pwd = settings["password"]
        context.on_cleanup(self.close)
        from futu import (OpenSecTradeContext, RET_OK, SecurityFirm,
                          SysConfig, TrdMarket)
        self.ret_ok = RET_OK
        if settings["rsa_file"]:
            SysConfig.enable_proto_encrypt(True)
            SysConfig.set_init_rsa_file(settings["rsa_file"])
        for market in (TrdMarket.HK, TrdMarket.US):
            trade = OpenSecTradeContext(
                filter_trdmarket=market, host=settings["host"], port=settings["port"],
                security_firm=SecurityFirm.FUTUSECURITIES,
            )
            self.contexts.append(trade)

    def snapshot(self) -> dict:
        for trade in self.contexts:
            ret, _ = trade.unlock_trade(self.trade_pwd)
            if ret != self.ret_ok:
                raise RuntimeError("unlock_trade rejected")
        return poll_once(self.contexts)

    def close(self) -> None:
        first_error = None
        for trade in list(self.contexts):
            try:
                # The pinned SDK may return without cleanup after close raises.
                # No supported recovery API can confirm release of that context.
                if id(trade) in self._close_failures:
                    raise self._close_failures[id(trade)]
                trade.close()
                self.contexts.remove(trade)
            except Exception as error:
                self._close_failures[id(trade)] = error
                if first_error is None:
                    first_error = error
        if first_error is not None:
            raise first_error


class PollLoop:
    def __init__(self, context: PluginContext) -> None:
        self.publisher = context.get(PORTS["publisher"])
        self.gateway = context.get(PORTS["gateway"])
        self.settings = context.capability("poll.settings")
        self.wait = context.capability("poll.wait")
        self.clock = context.capability("poll.clock")
        self.signal = context.signal

    def run(self) -> None:
        while not self.signal.is_set():
            if not self.settings["authenticated"]:
                self.publisher.send({"type": "auth-required",
                                     "secrets": ["futu-trade-password"]})
            else:
                try:
                    snapshot = self.gateway.snapshot()
                    snapshot["updatedAt"] = int(self.clock() * 1000)
                    self.publisher.send({"type": "data", "snapshot": snapshot})
                except Exception as exc:
                    self.publisher.send({"type": "error", "code": "poll-failed",
                                         "message": "%s: %s" % (type(exc).__name__, exc)})
            self.wait(self.settings["interval"])


class PollerRuntime:
    def __init__(self, host: PluginHost, errors: list) -> None:
        self.host = host
        self._errors = errors

    def start(self) -> list[dict]:
        self.host.require_owner_thread()
        self._errors.clear()
        catalog = self.host.start()
        failed = next((entry for entry in catalog if entry["manifest"]["id"] != "odk.futu.control"
                       and entry["state"] in ("failed", "cleanup-failed", "cleanup-blocked")), None)
        if failed and self.host.get(CONTROL_PORT) is None:
            failure = self.host.failure(failed["manifest"]["id"])
            self.host.stop()
            raise failure
        return catalog

    def run(self) -> None:
        self.host.require_owner_thread()
        try:
            self.start()
            while True:
                loop = self.host.get(PORTS["loop"])
                generation = self.host.generation("odk.futu.loop")
                if loop is not None:
                    try:
                        require_synchronous(loop.run())
                    except Exception as error:
                        if self.host.get(CONTROL_PORT) is None:
                            raise
                        if self.host.generation("odk.futu.loop") is generation:
                            self.host.fail("odk.futu.loop", error)
                control = self.host.get(CONTROL_PORT)
                if control is None:
                    break
                # A stopped or normally returned loop must not restart itself.
                # Only a lifecycle transition may select another generation.
                while self.host.generation("odk.futu.loop") is generation:
                    control.poll(0.1)
        except KeyboardInterrupt:
            pass
        finally:
            self.close()

    def close(self) -> None:
        self.host.require_owner_thread()
        self._errors.clear()
        self.host.stop()
        if self._errors:
            raise self._errors[0]

    def catalog(self) -> list[dict]:
        return self.host.catalog()

    def diagnose(self) -> dict:
        """Report this owned composition; lifecycle availability is not feature health."""
        return {"host": "python-agent", "instance": "futu-poller", **self.host.diagnose()}

    def set_enabled(self, identity: str, enabled: bool) -> list[dict]:
        return self.host.set_enabled(identity, enabled)


def create_poller(
    env: Mapping[str, str] | None = None,
    publisher_factory: Callable[[PluginContext], object] | None = None,
    gateway_factory: Callable[[PluginContext], object] | None = None,
    loop_factory: Callable[[PluginContext], object] | None = None,
    wait: Callable[[float], object] = time.sleep,
    clock: Callable[[], float] = time.time,
    disabled: tuple[str, ...] = (),
    transport_factory: Callable[[PluginContext], object] | None = None,
    replacement_plugins: Mapping[str, dict] | None = None,
    platform: str = sys.platform,
) -> PollerRuntime:
    """Compose trusted local plugins without opening channels or loading the SDK."""
    env = dict(os.environ if env is None else env)
    replacements = dict(replacement_plugins or {})
    known_replacements = {"odk.futu." + name for name in PORTS}
    if set(replacements) - known_replacements:
        raise ValueError("unknown development replacement")
    factories = {"publisher": publisher_factory, "gateway": gateway_factory,
                 "loop": loop_factory, "transport": transport_factory}
    if any(factory is not None and "odk.futu." + name in replacements for name, factory in factories.items()):
        raise ValueError("duplicate component factory selection")
    config_path = env.get("ODK_FUTU_PLUGIN_CONFIG")
    if config_path:
        config = read_config(config_path, {"odk.futu." + name for name in PORTS})
        disabled = tuple(set(disabled) | {identity for identity, preference in config["plugins"].items() if not preference["enabled"]})
    service = env.get("SERVICE_ID", "futu-poller")
    revision = env.get("ODK_FUTU_SERVICE_REVISION", "dev")
    credentials = {
        "host": env.get("FUTU_HOST", "10.10.0.195"),
        "port": int(env.get("FUTU_PORT", "11111")),
        "rsa_file": env.get("FUTU_RSA_FILE", ""),
        "password": env.get("FUTU_TRADE_PWD", ""),
    }
    interval = int(env.get("FUTU_INTERVAL", "60"))
    targets = {key: env[key] for key in (TARGETS_ENV, "ODK_FUTU_SOCKET", TOKEN_ENV) if key in env}
    control_endpoint, control_token_file = management_settings(env, platform)
    errors = []
    def wait_for_publication(seconds: float) -> object:
        publisher = host.get(PORTS["publisher"])
        control = host.get(CONTROL_PORT)
        if control is not None:
            if seconds < 0:
                raise ValueError("sleep length must be non-negative")
            selected_generation = host.generation("odk.futu.loop")
            deadline = time.monotonic() + seconds
            if wait is not time.sleep:
                control.poll(0)
                if host.generation("odk.futu.loop") is not selected_generation:
                    return None
                result = require_synchronous(wait(seconds))
                control.poll(0)
                return result
            while True:
                control.poll(0)
                if host.generation("odk.futu.loop") is not selected_generation:
                    return None
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                if publisher_factory is None and isinstance(publisher, LinkSet):
                    publisher.wait(min(remaining, 0.05))
                else:
                    control.poll(remaining)
        if wait is time.sleep and publisher_factory is None and isinstance(publisher, LinkSet):
            return publisher.wait(seconds)
        return wait(seconds)

    host = PluginHost(disabled=disabled, capabilities={
        "desk.targets": targets, "desk.identity": (service, revision),
        "futu.credentials": credentials,
        "poll.settings": {"interval": interval, "authenticated": bool(credentials["password"])},
        "poll.wait": wait_for_publication, "poll.clock": clock,
    }, on_error=lambda identity, error: errors.append(error))

    if control_endpoint:
        from management_channel import ManagementChannel, WindowsManagementChannel
        from plugin_control import dispatch_plugin_control
        if "odk.futu.control" in disabled:
            raise ValueError("protected control plugin cannot be disabled")
        def create_control(context):
            token = ""
            if control_token_file:
                with open(control_token_file, encoding="utf-8") as token_file:
                    token = token_file.read().strip()
            if platform == "win32" and not PIPE_PATTERN.match(control_endpoint):
                raise ValueError("Windows management requires a named pipe")
            channel_type = WindowsManagementChannel if PIPE_PATTERN.match(control_endpoint) else ManagementChannel
            channel = channel_type(control_endpoint, lambda request: dispatch_plugin_control(
                host, request, protected_ids=("odk.futu.control",), stopped=context.signal.is_set()), token=token)
            context.on_cleanup(channel.close)
            return {"ports": {CONTROL_PORT: channel}, "start": channel.start}
        host.register({"manifest": {"schemaVersion": 1, "id": "odk.futu.control", "name": "Futu runtime control",
                                   "version": "1.0.0", "host": "python-agent", "kind": "system",
                                   "provides": [{"interface": CONTROL_PORT}], "requires": []}, "create": create_control})

    def default_publisher(context):
        identity, version = context.capability("desk.identity")
        links = create_links(context.capability("desk.targets"), identity, version, _warn)
        transport = context.get(PORTS["transport"])
        for link in links:
            link.connector = transport.connect
            link.runtime_report = lambda: {"host": "python-agent", "instance": "futu-poller", **host.diagnose()}
        return LinkSet(links, identity)

    def register(name, requires, permissions, factory):
        manifest = {
            "schemaVersion": 1, "id": "odk.futu." + name, "name": "Futu " + name,
            "version": "1.0.0", "host": "python-agent", "kind": "transport" if name == "transport" else "service",
            "provides": [{"interface": PORTS[name]}],
            "requires": [{"interface": PORTS[dependency]} for dependency in requires],
            "permissions": permissions,
        }
        selected = replacements.get(manifest["id"])
        if selected is not None:
            from development_plugins import validate_contract
            manifest = validate_contract(selected["manifest"], manifest)
            factory = selected["create"]
            if not callable(factory):
                raise ValueError("development replacement requires callable create")
            if name == "gateway" and not credentials["password"]:
                factory = lambda context: object()
        def create(context):
            resource = require_synchronous(factory(context))
            cleanup = getattr(resource, "close", None)
            if cleanup is not None:
                context.on_cleanup(cleanup)
            operations = {"publisher": ("send",), "gateway": ("snapshot",) if credentials["password"] else (), "loop": ("run",), "transport": ("connect",)}
            for operation in operations[name]:
                if not callable(getattr(resource, operation, None)):
                    raise TypeError(name + " requires callable " + operation)
            return {"ports": {PORTS[name]: resource}}
        host.register({"manifest": manifest, "create": create})

    register("publisher", ["transport"] if publisher_factory is None else [],
             ["desk.targets", "desk.identity"], publisher_factory or default_publisher)
    # An unauthenticated gateway publishes a port but never imports the SDK.
    register("gateway", [], ["futu.credentials"],
             (gateway_factory or FutuGateway) if credentials["password"] else lambda context: object())
    register("loop", ["publisher", "gateway"], ["poll.settings", "poll.wait", "poll.clock"], loop_factory or PollLoop)
    class DefaultTransport:
        def connect(self, endpoint: Endpoint) -> object:
            return open_connection(endpoint)

    register("transport", [], [], transport_factory or (lambda context: DefaultTransport()))
    known = {entry["manifest"]["id"] for entry in host.catalog()}
    unknown = set(disabled) - known
    if unknown:
        raise ValueError("unknown disabled plugin: " + ", ".join(sorted(unknown)))
    return PollerRuntime(host, errors)


def main(argv: list[str] | None = None) -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Futu poller and local plugin inspection")
    parser.add_argument("--plugins", choices=("list", "validate", "enable", "disable"), help="inspect declarations or save startup preferences without starting providers")
    parser.add_argument("--disable-plugin", action="append", default=[], metavar="IDENTITY",
                        help="exclude a known component at this startup")
    parser.add_argument("--plugin-config", metavar="FILE", help="read or update this component preference file")
    parser.add_argument("--plugin", metavar="IDENTITY", help="known identity for a saved enable or disable operation")
    parser.add_argument("--plugin-directory", action="append", default=[], metavar="DIRECTORY",
                        help="select a local replacement package for this startup")
    parser.add_argument("--trust-plugins", action="store_true", help="trust the selected Python entries with native process access")
    parser.add_argument("--grant-plugin", action="append", default=[], metavar="IDENTITY:CAPABILITY",
                        help="grant a declared capability to a selected replacement")
    arguments = parser.parse_args(argv)
    mutation = arguments.plugins in ("enable", "disable")
    if mutation and (not arguments.plugin or not arguments.plugin_config or arguments.disable_plugin):
        parser.error("saved selection requires --plugin and --plugin-config without --disable-plugin")
    if arguments.plugin and not mutation:
        parser.error("--plugin requires an enable or disable operation")
    if (arguments.trust_plugins or arguments.grant_plugin) and not arguments.plugin_directory:
        parser.error("development trust and grants require --plugin-directory")
    if mutation and arguments.plugin_directory:
        parser.error("saved preference writes cannot select development entries")
    # Inspection never consumes operational credentials or endpoint configuration.
    try:
        if mutation:
            runtime = create_poller({})
            runtime.host.validate()
            known = {entry["manifest"]["id"] for entry in runtime.catalog()}
            enabled = arguments.plugins == "enable"
            update_enabled(arguments.plugin_config, arguments.plugin, enabled, known)
            print(json.dumps({"host": "python-agent", "scope": "preferences", "pluginId": arguments.plugin,
                              "enabled": enabled, "applies": "next-startup"}))
            return
        env = None
        if arguments.plugins:
            env = {}
            if os.environ.get("ODK_FUTU_PLUGIN_CONFIG"):
                env["ODK_FUTU_PLUGIN_CONFIG"] = os.environ["ODK_FUTU_PLUGIN_CONFIG"]
        if arguments.plugin_config:
            env = dict(os.environ) if env is None else env
            env["ODK_FUTU_PLUGIN_CONFIG"] = arguments.plugin_config
        shared_disabled = resolve_shared_disabled(os.environ, {"odk.futu." + name for name in PORTS}, _warn)
        options = {"disabled": tuple(sorted(set(arguments.disable_plugin) | set(shared_disabled)))}
        if arguments.plugin_directory:
            from development_plugins import load_replacements
            contracts = [entry["manifest"] for entry in create_poller({}).catalog()]
            options["replacement_plugins"] = load_replacements(arguments.plugin_directory, contracts,
                trusted=arguments.trust_plugins, grants=arguments.grant_plugin)
        runtime = create_poller(env, **options)
    except (ValueError, OSError) as error:
        parser.error(str(error))
    if arguments.plugins:
        if arguments.plugins == "validate":
            runtime.host.validate()
        print(json.dumps({"host": "python-agent", "scope": "declarations",
                          "validated": arguments.plugins == "validate", "plugins": runtime.catalog()}))
        return
    runtime.run()


if __name__ == "__main__":
    main()
