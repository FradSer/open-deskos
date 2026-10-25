"""Probe the running worker control channel without touching its gateway."""
import json
import os
import socket
import sys
import time
import uuid
from collections.abc import Mapping

from poller import management_settings, read_token_file, handshake_frame


def check_health(env: Mapping[str, str] | None = None) -> bool:
    """Establish current local control readiness, not provider authentication."""
    env = os.environ if env is None else env
    endpoint, token_file = management_settings(env, sys.platform)
    if not endpoint or not os.path.isabs(endpoint) or sys.platform == "win32":
        return False
    deadline = time.monotonic() + 2
    request_id = uuid.uuid4().hex
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
            def set_remaining_timeout() -> None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError("Local control health budget exhausted")
                peer.settimeout(remaining)
            set_remaining_timeout()
            peer.connect(endpoint)
            if token_file:
                frame = handshake_frame(read_token_file(token_file))
                set_remaining_timeout()
                peer.sendall(frame)
            set_remaining_timeout()
            peer.sendall(json.dumps({"v": 1, "id": request_id, "command": "inventory"}).encode() + b"\n")
            data = b""
            while b"\n" not in data:
                set_remaining_timeout()
                part = peer.recv(min(4096, 32769 - len(data)))
                if not part or len(data) + len(part) > 32768:
                    return False
                data += part
            set_remaining_timeout()
            reply = json.loads(data.split(b"\n", 1)[0])
            if not isinstance(reply, dict):
                return False
            return (reply.get("v") == 1 and reply.get("id") == request_id and reply.get("ok") is True
                    and reply.get("scope") == "python-agent" and isinstance(reply.get("plugins"), list)
                    and any(item.get("pluginId") == "odk.futu.control" for item in reply["plugins"] if isinstance(item, dict)))
    except (OSError, ValueError, TypeError):
        return False


if __name__ == "__main__":
    ready = check_health()
    print("Futu worker control ready." if ready else "Futu worker control unavailable.")
    raise SystemExit(0 if ready else 1)
