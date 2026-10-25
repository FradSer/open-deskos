"""Exclusive serial worker. Inventory never opens a port; selection uses USB serial identity."""
from __future__ import annotations

import argparse
import json
import queue
import sys
import threading

import serial
from serial.tools import list_ports


def inventory() -> list[dict[str, str | int | None]]:
    return [{"port": p.device, "vid": p.vid, "pid": p.pid, "serialNumber": p.serial_number}
            for p in list_ports.comports() if p.vid == 0x303A and p.pid == 0x1001]


def emit(record: dict[str, object]) -> None:
    print(json.dumps(record, separators=(",", ":")), flush=True)


def run(serial_number: str) -> int:
    matches = [p for p in inventory() if str(p["serialNumber"]).lower() == serial_number.lower()]
    if len(matches) != 1:
        emit({"v": 1, "type": "transport-error", "reason": "ambiguous-device" if matches else "device-not-found"})
        return 1
    commands: queue.Queue[bytes | None] = queue.Queue(maxsize=16)
    ended = threading.Event()

    def read_commands() -> None:
        try:
            while True:
                line = sys.stdin.buffer.readline(513)
                if not line:
                    break
                if len(line) > 512 or not line.endswith(b"\n"):
                    return
                commands.put_nowait(line)
        except (queue.Full, OSError):
            pass
        finally:
            ended.set()
            try:
                commands.put_nowait(None)
            except queue.Full:
                pass

    port = serial.Serial(port=None, baudrate=115200, timeout=0.05, write_timeout=1)
    port.dtr = False
    port.rts = False
    port.port = str(matches[0]["port"])
    if sys.platform != "win32":
        port.exclusive = True
    pending = bytearray()
    discard = False
    try:
        with port:
            threading.Thread(target=read_commands, daemon=True).start()
            while True:
                try:
                    command = commands.get_nowait()
                    if command is None:
                        return 0
                    port.write(command)
                except queue.Empty:
                    if ended.is_set():
                        return 0
                for byte in port.read(512):
                    if byte == 10:
                        if not discard and pending:
                            sys.stdout.buffer.write(pending + b"\n")
                            sys.stdout.buffer.flush()
                        pending.clear()
                        discard = False
                    elif not discard:
                        pending.append(byte)
                        if len(pending) >= 512:
                            pending.clear()
                            discard = True
    except (serial.SerialException, OSError):
        emit({"v": 1, "type": "transport-error", "reason": "device-unavailable"})
        return 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inventory", action="store_true")
    parser.add_argument("--serial-number")
    args = parser.parse_args()
    if args.inventory:
        print(json.dumps(inventory(), separators=(",", ":")))
        return 0
    if not args.serial_number:
        parser.error("--serial-number is required")
    return run(args.serial_number)


if __name__ == "__main__":
    raise SystemExit(main())
