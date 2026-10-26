"""Explicit hardware acceptance. Opens one selected USB device and sends bounded test requests."""
from __future__ import annotations

import argparse
import json
import time

import serial
from serial.tools import list_ports


def check_device(serial_number: str) -> dict[str, object]:
    matches = [p for p in list_ports.comports()
               if p.vid == 0x303A and p.pid == 0x1001 and p.serial_number
               and p.serial_number.lower() == serial_number.lower()]
    if len(matches) != 1:
        raise RuntimeError("Selected USB identity is missing or ambiguous")
    port = serial.Serial(port=None, baudrate=115200, timeout=0.1, write_timeout=1)
    port.dtr = False
    port.rts = False
    port.port = matches[0].device
    with port:
        def request(kind: str, identity: str, **fields: object) -> dict[str, object]:
            record = {"v": 1, "type": kind, "id": identity, **fields}
            port.write(json.dumps(record, separators=(",", ":")).encode() + b"\n")
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                line = port.readline(513)
                if not line:
                    continue
                reply = json.loads(line.decode("utf-8"))
                if reply.get("id") == identity:
                    return reply
            raise RuntimeError("Firmware reply deadline: " + identity)

        hello = request("hello", "accept-hello")
        assert hello["board"] == "m5stack-nanoc6"
        assert hello["firmware"] == "0.1.0"
        assert hello["radio"] is True
        assert hello["peers"] == 0, "Acceptance requires an unprovisioned gateway"
        for index in range(10):
            assert request("ping", "accept-ping-" + str(index))["ok"] is True
        invalid = [
            b'x' * 600 + b'{"v":1,"type":"ping","id":"discard-tail"}\n',
            b'{"v":2,"type":"ping","id":"discard-version"}\n',
            b'{"v":1,"type":"ping","id":"discard-utf8","x":"\xff"}\n',
            b'{"v":1,"v":1,"type":"ping","id":"discard-duplicate"}\n',
            b'{"v":1,"type":"ping","id":"discard-nul"}\x00\n',
        ]
        for packet in invalid:
            port.write(packet)
        # Any incorrectly accepted bad request will arrive before this ping reply.
        port.write(b'{"v":1,"type":"ping","id":"accept-recovery"}\n')
        deadline = time.monotonic() + 3
        recovered = False
        while time.monotonic() < deadline:
            line = port.readline(513)
            if not line:
                continue
            reply = json.loads(line.decode("utf-8"))
            assert not str(reply.get("id", "")).startswith("discard-"), reply
            if reply.get("id") == "accept-recovery":
                assert reply["ok"] is True
                recovered = True
                break
        assert recovered
        assert request("configure", "accept-invalid-config", channel=99, pmk="bad")["type"] == "error"
        assert request("send", "accept-no-peer", peer="02:11:22:33:44:55", payload="eA==")["type"] == "error"
        state = request("status", "accept-status")
        assert state["session"] == hello["session"]
        assert state["peers"] == 0 and state["channel"] == 1
        return {"result": "PASS", "board": hello["board"], "firmware": hello["firmware"],
                "mac": hello["mac"], "radioInitialized": hello["radio"], "channel": state["channel"],
                "peers": state["peers"], "usbPings": 10, "malformedCases": len(invalid),
                "invalidConfigurationRejected": True, "unconfiguredSendRejected": True}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial-number", required=True)
    args = parser.parse_args()
    print(json.dumps(check_device(args.serial_number), separators=(",", ":")))


if __name__ == "__main__":
    main()
