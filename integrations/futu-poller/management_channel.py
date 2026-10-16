"""Independent local management channel; its owner pumps all lifecycle work."""
import hmac
import errno
import json
import os
from pathlib import Path
import re
import selectors
import socket
import stat
from threading import current_thread
import time
from typing import Callable


def read_management_frame(pending: bytes, authenticated: bool, token: str,
                          require_token: bool) -> tuple[bytes, bool, dict | None]:
    """Decode the shared byte-stream handshake and one command."""
    if not authenticated:
        if b"\n" not in pending:
            if len(pending) > (512 if require_token else 4096):
                raise ValueError("management handshake exceeds budget")
            return pending, False, None
        line, remainder = pending.split(b"\n", 1)
        candidate = json.loads(line)
        if isinstance(candidate, dict) and "token" in candidate:
            if (len(line) > 512 or candidate.get("v") != 1 or isinstance(candidate.get("v"), bool)
                    or not isinstance(candidate["token"], str) or not token
                    or not hmac.compare_digest(candidate["token"].encode(), token.encode())):
                raise ValueError("management authentication failed")
            pending = remainder
        elif require_token:
            raise ValueError("management authentication required")
        authenticated = True
    if len(pending) > 4096:
        raise ValueError("management request exceeds budget")
    if b"\n" not in pending:
        return pending, authenticated, None
    line, remainder = pending.split(b"\n", 1)
    if remainder.strip():
        raise ValueError("management accepts one request")
    request = json.loads(line)
    if (not isinstance(request, dict) or request.get("v") != 1 or isinstance(request.get("v"), bool)
            or not isinstance(request.get("id"), str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", request["id"])):
        raise ValueError("invalid management envelope")
    return b"", authenticated, request


def management_response(dispatch: Callable[[dict], dict], request: dict) -> bytes:
    try:
        result = dispatch(request)
    except Exception:
        result = {"ok": False, "error": "lifecycle-failed"}
    response = json.dumps({**result, "v": 1, "id": request["id"]}, ensure_ascii=False,
                          allow_nan=False, separators=(",", ":")).encode() + b"\n"
    if len(response) > 32768:
        raise ValueError("management response exceeds budget")
    return response


class ManagementChannel:
    def __init__(self, endpoint: str, dispatch: Callable[[dict], dict], *,
                 token: str = "", require_token: bool = False) -> None:
        self.endpoint = Path(endpoint)
        self.dispatch = dispatch
        self.token = token
        self.require_token = require_token
        self._owner = current_thread()
        self._selector = selectors.DefaultSelector()
        self._listener = None
        self._identity = None
        self._clients = {}
        self._closed = False

    def _require_owner(self) -> None:
        if current_thread() is not self._owner:
            raise RuntimeError("management operation requires its owner thread")

    def start(self) -> None:
        self._require_owner()
        if self._closed:
            raise RuntimeError("management channel is closed")
        if self._listener is not None:
            return
        if not self.endpoint.is_absolute() or (self.require_token and not self.token):
            raise ValueError("management endpoint or token unavailable")
        self.endpoint.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        directory = self.endpoint.parent.lstat()
        if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid() or directory.st_mode & 0o077:
            raise PermissionError("management directory requires private ownership")
        self._recover_stale_endpoint()
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            listener.bind(str(self.endpoint))
            info = self.endpoint.lstat()
            self._identity = (info.st_dev, info.st_ino)
            self._listener = listener
            os.chmod(self.endpoint, 0o600)
            listener.listen(16)
            listener.setblocking(False)
            self._selector.register(listener, selectors.EVENT_READ, None)
        except BaseException:
            # A successful bind owns the pathname even if later startup fails.
            if self._identity is not None:
                self.close()
            else:
                listener.close()
            raise

    def _recover_stale_endpoint(self) -> None:
        try:
            before = self.endpoint.lstat()
        except FileNotFoundError:
            return
        if not stat.S_ISSOCK(before.st_mode) or before.st_uid != os.getuid():
            raise OSError("management endpoint already exists")
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            probe.settimeout(0.2)
            try:
                probe.connect(str(self.endpoint))
            except OSError as error:
                if error.errno not in (errno.ECONNREFUSED, errno.ENOENT):
                    raise OSError("management endpoint availability unknown") from error
            else:
                raise OSError("management endpoint already active")
        finally:
            probe.close()
        try:
            after = self.endpoint.lstat()
        except FileNotFoundError:
            return
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
            raise OSError("management endpoint ownership changed")
        self.endpoint.unlink()

    def _drop(self, client: socket.socket) -> None:
        self._clients.pop(client, None)
        try:
            self._selector.unregister(client)
        except KeyError:
            pass
        client.close()

    def poll(self, seconds: float = 0) -> None:
        """Process one readiness batch without running work on another thread."""
        self._require_owner()
        if seconds < 0:
            raise ValueError("management wait must be non-negative")
        if self._closed or self._listener is None:
            return
        now = time.monotonic()
        for client, state in list(self._clients.items()):
            if now >= state["deadline"]:
                self._drop(client)
        timeout = seconds
        if self._clients:
            timeout = min(timeout, max(0, min(state["deadline"] for state in self._clients.values()) - now))
        for key, events in self._selector.select(timeout):
            client = key.fileobj
            if client is self._listener:
                peer, _ = self._listener.accept()
                if len(self._clients) >= 16:
                    peer.close()
                    continue
                peer.setblocking(False)
                state = {"buffer": b"", "response": None, "authenticated": False,
                         "deadline": time.monotonic() + 1}
                self._clients[peer] = state
                self._selector.register(peer, selectors.EVENT_READ, state)
                continue
            state = key.data
            try:
                if events & selectors.EVENT_WRITE:
                    sent = client.send(state["response"])
                    state["response"] = state["response"][sent:]
                    if not state["response"]:
                        self._drop(client)
                    continue
                data = client.recv(4097)
                if not data:
                    self._drop(client)
                    continue
                state["buffer"] += data
                self._read(client, state)
            except BlockingIOError:
                continue
            except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
                self._drop(client)

    def _read(self, client: socket.socket, state: dict) -> None:
        state["buffer"], state["authenticated"], request = read_management_frame(
            state["buffer"], state["authenticated"], self.token, self.require_token)
        if request is None:
            return
        # Dispatch is synchronous and only reached by the resource owner.
        state["response"] = management_response(self.dispatch, request)
        state["deadline"] = time.monotonic() + 1
        self._selector.modify(client, selectors.EVENT_WRITE, state)

    def close(self) -> None:
        self._require_owner()
        for client in list(self._clients):
            self._drop(client)
        if self._listener is not None:
            try:
                self._selector.unregister(self._listener)
            except KeyError:
                pass
            self._listener.close()
            self._listener = None
        if self._identity is not None:
            try:
                info = self.endpoint.lstat()
            except FileNotFoundError:
                info = None
            if info is not None:
                if (info.st_dev, info.st_ino) != self._identity:
                    raise RuntimeError("management endpoint ownership changed")
                self.endpoint.unlink()
            self._identity = None
        self._selector.close()
        self._closed = True


class WindowsManagementChannel:
    """Raw byte-mode pipes using CPython's overlapped I/O wrapper."""
    def __init__(self, endpoint: str, dispatch: Callable[[dict], dict], *, token: str = "", api: object | None = None) -> None:
        self.endpoint = endpoint
        self.dispatch = dispatch
        self.token = token
        self._api = api
        self._owner = current_thread()
        self._states = {}
        self._stopping = False
        self._started = False

    def _require_owner(self) -> None:
        if current_thread() is not self._owner:
            raise RuntimeError("management operation requires its owner thread")

    def start(self) -> None:
        self._require_owner()
        if self._stopping:
            raise RuntimeError("management channel is closed")
        if self._started:
            return
        if not re.match(r"^\\\\\.\\pipe\\", self.endpoint, re.IGNORECASE) or not self.token:
            raise ValueError("management pipe or token unavailable")
        if self._api is None:
            import _winapi
            self._api = _winapi
        self._new_listener()
        self._started = True

    def _new_listener(self) -> None:
        flags = self._api.PIPE_ACCESS_DUPLEX | self._api.FILE_FLAG_OVERLAPPED
        if not self._states:
            flags |= self._api.FILE_FLAG_FIRST_PIPE_INSTANCE
        # Byte mode preserves the Node channel protocol; 8 rejects remote clients.
        handle = self._api.CreateNamedPipe(self.endpoint, flags, 8, 16, 32768, 4096, 0, self._api.NULL)
        state = {"phase": "connect", "operation": None, "buffer": b"", "authenticated": False,
                 "response": b"", "deadline": None}
        self._states[handle] = state
        try:
            state["operation"] = self._api.ConnectNamedPipe(handle, overlapped=True)
        except BaseException:
            state["phase"] = "closing"
            self._retire(handle, state)
            raise

    def _retire(self, handle: int, state: dict) -> None:
        state["phase"] = "closing"
        operation = state["operation"]
        if operation is not None:
            operation.cancel()
            try:
                _, error = operation.GetOverlappedResult(False)
            except OSError:
                # CPython clears pending on terminal native errors; incomplete
                # operations return 996 instead of raising. Cancellation errors
                # above still retain the operation and its buffers.
                error = 0
            if error == 996:  # ERROR_IO_INCOMPLETE: keep the operation and its buffers alive.
                raise RuntimeError("management pipe cancellation pending")
            state["operation"] = None
        self._api.CloseHandle(handle)
        del self._states[handle]

    def _read(self, handle: int, state: dict) -> None:
        state["phase"] = "read"
        state["operation"], _ = self._api.ReadFile(handle, 4097, overlapped=True)

    def _write(self, handle: int, state: dict) -> None:
        state["phase"] = "write"
        state["operation"], _ = self._api.WriteFile(handle, state["response"], overlapped=True)

    def _complete(self, handle: int, state: dict) -> bool:
        if state["phase"] == "closing":
            self._retire(handle, state)
            return True
        count, error = state["operation"].GetOverlappedResult(False)
        if error == 996:
            return False
        if error != 0:
            self._retire(handle, state)
            return True
        if state["phase"] == "connect":
            state["deadline"] = time.monotonic() + 1
            self._read(handle, state)
        elif state["phase"] == "read":
            if count == 0:
                self._retire(handle, state)
                return True
            state["buffer"] += state["operation"].getbuffer()
            state["buffer"], state["authenticated"], request = read_management_frame(
                state["buffer"], state["authenticated"], self.token, True)
            if request is None:
                self._read(handle, state)
            else:
                state["response"] = management_response(self.dispatch, request)
                state["deadline"] = time.monotonic() + 1
                self._write(handle, state)
        else:
            if count <= 0 or count > len(state["response"]):
                raise ValueError("invalid pipe response write")
            state["response"] = state["response"][count:]
            if state["response"]:
                self._write(handle, state)
            else:
                self._retire(handle, state)
        return True

    def poll(self, seconds: float = 0) -> None:
        self._require_owner()
        if seconds < 0:
            raise ValueError("management wait must be non-negative")
        if self._stopping or not self._started:
            return
        progressed = False
        now = time.monotonic()
        for handle, state in list(self._states.items()):
            try:
                if state["deadline"] is not None and now >= state["deadline"]:
                    self._retire(handle, state)
                    progressed = True
                else:
                    progressed = self._complete(handle, state) or progressed
            except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
                try:
                    self._retire(handle, state)
                except (OSError, RuntimeError):
                    pass
                progressed = True
            except RuntimeError:
                # Cancellation retains ownership and is retried on the next pump.
                pass
        if len(self._states) < 16 and not any(state["phase"] == "connect" for state in self._states.values()):
            try:
                self._new_listener()
            except OSError:
                # Keep established clients if another listener cannot be acquired.
                pass
        if not progressed and self._states:
            deadlines = [state["deadline"] for state in self._states.values() if state["deadline"] is not None]
            if deadlines:
                seconds = min(seconds, max(0, min(deadlines) - time.monotonic()))
            events = [state["operation"].event for state in self._states.values() if state["operation"] is not None]
            if events:
                self._api.WaitForMultipleObjects(events, False, min(int(seconds * 1000), 60000))

    def close(self) -> None:
        self._require_owner()
        self._stopping = True
        error = None
        for handle, state in list(self._states.items()):
            try:
                self._retire(handle, state)
            except (OSError, RuntimeError) as failure:
                if error is None:
                    error = failure
        if error is not None:
            raise error
