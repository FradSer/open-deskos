import time
from .config import P4_RESULT_MAX_AGE_SECONDS


class FaceAgentState:
    def __init__(self, device):
        self.device = device
        self.latest_result = None
        self.last_frame_at = None
        self.capture_status = "starting"
        self.capture_error = None
        self.last_p4_sequence = None

    def mark_degraded(self, error):
        self.capture_status = "camera-unavailable"
        self.capture_error = error
        self.latest_result = None

    def mark_no_frame(self):
        self.capture_status = "no-frame"
        self.capture_error = None
        self.last_p4_sequence = None

    def record_frame(self, result):
        self.last_p4_sequence = result["sequence"]
        self.latest_result = result
        self.last_frame_at = time.time()
        self.capture_status = "online"
        self.capture_error = None

    def status_payload(self):
        if self.capture_status == "online" and self.last_frame_at is not None and time.time() - self.last_frame_at > P4_RESULT_MAX_AGE_SECONDS:
            self.mark_degraded("p4-inference-stale")
        return {
            "status": self.capture_status,
            "device": self.device,
            "capture": {"last_frame_at": self.last_frame_at, "error": self.capture_error},
            "owner_enrolled": bool(self.latest_result and self.latest_result["any_unlocked"]),
            "owners": [],
            "latest_result": self.latest_result if self.capture_status == "online" else None,
        }
