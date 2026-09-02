import asyncio
import json
import time

try:
    import serial
except ImportError:
    serial = None

from .config import (
    CAPTURE_RETRY_SECONDS,
    FRAME_READ_TIMEOUT_SECONDS,
    MAX_CONSECUTIVE_READ_FAILURES,
)
from .normalizer import normalize_p4_inference_metadata


class SerialCaptureTransport:
    def __init__(self, device, state):
        self.device = device
        self.state = state
        self.is_running = False

    async def run_loop(self):
        if serial is None:
            self.state.mark_degraded("pyserial-not-installed")
            return

        self.is_running = True
        while self.is_running:
            try:
                ser = await asyncio.to_thread(serial.Serial, self.device, 115200, timeout=1.0)
            except Exception as error:
                self.state.mark_degraded(f"serial-open-failed: {error}")
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)
                continue

            self.state.mark_no_frame()
            consecutive_failures = 0
            try:
                while self.is_running:
                    try:
                        raw_line = await asyncio.wait_for(
                            asyncio.to_thread(ser.readline),
                            timeout=FRAME_READ_TIMEOUT_SECONDS,
                        )
                    except TimeoutError:
                        raw_line = b""
                    if not raw_line:
                        consecutive_failures += 1
                        if consecutive_failures >= MAX_CONSECUTIVE_READ_FAILURES:
                            self.state.mark_degraded("serial-read-timeout")
                        await asyncio.sleep(0.05)
                        continue

                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not (line.startswith("{") and line.endswith("}")):
                        continue
                    try:
                        result = normalize_p4_inference_metadata(json.loads(line))
                    except json.JSONDecodeError:
                        continue
                    if (
                        result is None
                        or (
                            self.state.last_p4_sequence is not None
                            and result["sequence"] <= self.state.last_p4_sequence
                        )
                    ):
                        continue

                    consecutive_failures = 0
                    self.state.record_frame(result)
            finally:
                ser.close()
            if self.is_running:
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)

    def stop(self):
        self.is_running = False
