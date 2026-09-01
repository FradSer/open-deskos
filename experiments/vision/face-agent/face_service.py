import asyncio
import json
import os
import time

try:
    import serial
except ImportError:
    serial = None

from aiohttp import web

DEFAULT_DEVICE = "/dev/open-deskos-p4-camera"
DEFAULT_PORT = 8790
CAPTURE_RETRY_SECONDS = 2.0
FRAME_READ_TIMEOUT_SECONDS = 2.0
MAX_CONSECUTIVE_READ_FAILURES = 3
P4_RESULT_MAX_AGE_SECONDS = 3.0


def capture_config(env=os.environ):
    device = env.get("FACE_AGENT_DEVICE", DEFAULT_DEVICE)
    if device != DEFAULT_DEVICE:
        raise ValueError("Face Agent accepts only the ESP32-P4 camera serial device")
    try:
        port = int(env.get("FACE_AGENT_PORT", DEFAULT_PORT))
    except (TypeError, ValueError):
        port = DEFAULT_PORT
    return {"device": device, "port": port if port > 0 else DEFAULT_PORT}


def finite_number(value):
    if isinstance(value, bool):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed == parsed and abs(parsed) != float("inf") else None


def bounded_score(value):
    parsed = finite_number(value)
    return parsed if parsed is not None and 0 <= parsed <= 1 else None


def normalize_face(face, width, height):
    if not isinstance(face, dict):
        return None

    box = face.get("box")
    if not isinstance(box, list) or len(box) != 4 or not all(isinstance(item, int) and not isinstance(item, bool) for item in box):
        return None
    x, y, box_width, box_height = box
    if x < 0 or y < 0 or box_width <= 0 or box_height <= 0 or x + box_width > width or y + box_height > height:
        return None

    detect_score = bounded_score(face.get("detect_score"))
    landmarks = face.get("landmarks")
    if detect_score is None or not isinstance(landmarks, list) or len(landmarks) != 5:
        return None

    normalized_landmarks = []
    for point in landmarks:
        if not isinstance(point, list) or len(point) != 2:
            return None
        point_x = finite_number(point[0])
        point_y = finite_number(point[1])
        if point_x is None or point_y is None or not 0 <= point_x < width or not 0 <= point_y < height:
            return None
        normalized_landmarks.append([point_x, point_y])

    normalized = {"box": box, "detect_score": detect_score, "landmarks": normalized_landmarks}
    identity = face.get("face_id")
    if isinstance(identity, dict):
        unlocked = identity.get("unlocked")
        user = identity.get("user")
        similarity = bounded_score(identity.get("similarity"))
        threshold = bounded_score(identity.get("threshold"))
        if isinstance(unlocked, bool) and isinstance(user, str) and len(user) <= 32 and similarity is not None and threshold is not None:
            normalized["face_id"] = {
                "unlocked": unlocked,
                "user": user,
                "similarity": similarity,
                "threshold": threshold,
            }

    emotion = face.get("emotion")
    if isinstance(emotion, dict):
        primary = emotion.get("primary")
        confidence = bounded_score(emotion.get("confidence"))
        if primary in {"neutral", "happiness", "surprise", "sadness", "anger", "disgust", "fear", "contempt"} and confidence is not None:
            normalized["emotion"] = {"primary": primary, "confidence": confidence}
    return normalized


def normalize_p4_inference_metadata(meta):
    if not isinstance(meta, dict) or meta.get("v") != 1 or not isinstance(meta.get("online"), bool):
        return None

    width = meta.get("width")
    height = meta.get("height")
    sequence = meta.get("sequence")
    current_face_index = meta.get("current_face_index")
    declared_count = meta.get("faces_count")
    processing_time_ms = finite_number(meta.get("processing_time_ms"))
    faces = meta.get("faces")
    if (
        not isinstance(width, int) or not isinstance(height, int) or width <= 0 or height <= 0
        or not isinstance(sequence, int) or sequence < 0
        or not isinstance(current_face_index, int)
        or not isinstance(declared_count, int) or declared_count < 0 or declared_count > 4
        or (declared_count == 0 and current_face_index != -1)
        or (declared_count > 0 and not 0 <= current_face_index < declared_count)
        or processing_time_ms is None or processing_time_ms < 0
        or not isinstance(faces, list) or len(faces) != declared_count
    ):
        return None

    normalized_faces = [normalize_face(face, width, height) for face in faces]
    if any(face is None for face in normalized_faces):
        return None

    any_unlocked = meta.get("any_unlocked")
    if not isinstance(any_unlocked, bool):
        return None
    actual_unlocked = any(face.get("face_id", {}).get("unlocked", False) for face in normalized_faces)
    if actual_unlocked != any_unlocked:
        return None

    return {
        "camera_online": meta["online"],
        "frame_width": width,
        "frame_height": height,
        "sequence": sequence,
        "current_face_index": current_face_index,
        "faces_count": len(normalized_faces),
        "any_unlocked": any_unlocked,
        "faces": normalized_faces,
        "processing_time_ms": processing_time_ms,
        "source": "esp32p4_on_device_inference",
    }


class FaceAgentService:
    def __init__(self, device=None, port=None):
        config = capture_config()
        self.device = device or config["device"]
        if self.device != DEFAULT_DEVICE:
            raise ValueError("Face Agent accepts only the ESP32-P4 camera serial device")
        self.port = port or config["port"]
        self.app = web.Application()
        self.app.router.add_get("/status", self.handle_status)
        self.latest_result = None
        self.last_frame_at = None
        self.capture_status = "starting"
        self.capture_error = None
        self.is_running = False
        self.last_p4_sequence = None

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

    def mark_degraded(self, error):
        self.capture_status = "camera-unavailable"
        self.capture_error = error
        self.latest_result = None

    async def handle_status(self, request):
        return web.json_response(self.status_payload())

    async def serial_capture_loop(self):
        if serial is None:
            self.mark_degraded("pyserial-not-installed")
            return

        self.is_running = True
        while self.is_running:
            try:
                ser = await asyncio.to_thread(serial.Serial, self.device, 115200, timeout=1.0)
            except Exception as error:
                self.mark_degraded(f"serial-open-failed: {error}")
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)
                continue

            self.capture_status = "no-frame"
            self.capture_error = None
            self.last_p4_sequence = None
            consecutive_failures = 0
            try:
                while self.is_running:
                    try:
                        raw_line = await asyncio.wait_for(asyncio.to_thread(ser.readline), timeout=FRAME_READ_TIMEOUT_SECONDS)
                    except TimeoutError:
                        raw_line = b""
                    if not raw_line:
                        consecutive_failures += 1
                        if consecutive_failures >= MAX_CONSECUTIVE_READ_FAILURES:
                            self.mark_degraded("serial-read-timeout")
                        await asyncio.sleep(0.05)
                        continue

                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not (line.startswith("{") and line.endswith("}")):
                        continue
                    try:
                        result = normalize_p4_inference_metadata(json.loads(line))
                    except json.JSONDecodeError:
                        continue
                    if result is None or (self.last_p4_sequence is not None and result["sequence"] <= self.last_p4_sequence):
                        continue

                    consecutive_failures = 0
                    self.last_p4_sequence = result["sequence"]
                    self.latest_result = result
                    self.last_frame_at = time.time()
                    self.capture_status = "online"
                    self.capture_error = None
            finally:
                ser.close()
            if self.is_running:
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)

    async def start(self):
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", self.port)
        await site.start()
        try:
            await self.serial_capture_loop()
        finally:
            await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(FaceAgentService().start())
