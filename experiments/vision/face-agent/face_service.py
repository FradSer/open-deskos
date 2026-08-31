import asyncio
import json
import os
import time

try:
    import serial
except ImportError:
    serial = None

import cv2
from aiohttp import web

try:
    from face_engine import FaceAgentEngine
except ImportError:
    FaceAgentEngine = None

DEFAULT_DEVICE = "/dev/video0"
DEFAULT_WIDTH = 640
DEFAULT_HEIGHT = 480
DEFAULT_FPS = 30
DEFAULT_PORT = 8790
CAPTURE_RETRY_SECONDS = 2.0
CAMERA_OPEN_TIMEOUT_SECONDS = 3.0
FRAME_READ_TIMEOUT_SECONDS = 2.0
MAX_CONSECUTIVE_READ_FAILURES = 3
P4_RESULT_MAX_AGE_SECONDS = 3.0


def is_serial_device(device_path):
    if not device_path:
        return False
    return (
        device_path.startswith("/dev/ttyACM")
        or device_path.startswith("/dev/ttyUSB")
        or device_path == "/dev/open-deskos-p4-camera"
    )


def resolve_device(requested_device):
    if requested_device and os.path.exists(requested_device):
        return requested_device
    # Auto-detect fallback: check for ESP32-P4 camera on ACM0/USB0 if video0 is missing
    if requested_device == DEFAULT_DEVICE and not os.path.exists(DEFAULT_DEVICE):
        for candidate in ["/dev/ttyACM0", "/dev/ttyUSB0"]:
            if os.path.exists(candidate):
                return candidate
    return requested_device or DEFAULT_DEVICE


def positive_integer(value, default):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def capture_config(env=os.environ):
    return {
        "device": env.get("FACE_AGENT_DEVICE", DEFAULT_DEVICE),
        "width": positive_integer(env.get("FACE_AGENT_WIDTH"), DEFAULT_WIDTH),
        "height": positive_integer(env.get("FACE_AGENT_HEIGHT"), DEFAULT_HEIGHT),
        "fps": positive_integer(env.get("FACE_AGENT_FPS"), DEFAULT_FPS),
        "port": positive_integer(env.get("FACE_AGENT_PORT"), DEFAULT_PORT),
    }


def open_camera(device, width, height, fps):
    cap = cv2.VideoCapture(device, cv2.CAP_V4L2)
    if not cap.isOpened():
        return cap
    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, width)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, height)
    cap.set(cv2.CAP_PROP_FPS, fps)
    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return cap


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
    if detect_score is None:
        return None

    landmarks = face.get("landmarks")
    if not isinstance(landmarks, list) or len(landmarks) != 5:
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

    normalized = {
        "box": box,
        "detect_score": detect_score,
        "landmarks": normalized_landmarks,
    }

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
    def __init__(self, device=None, port=None, width=None, height=None, fps=None):
        config = capture_config()
        self.device = resolve_device(device or config["device"])
        self.port = port or config["port"]
        self.width = width or config["width"]
        self.height = height or config["height"]
        self.fps = fps or config["fps"]
        self.engine = None if is_serial_device(self.device) else FaceAgentEngine()
        self.app = web.Application()
        self.setup_routes()

        self.latest_frame = None
        self.latest_result = None
        self.latest_annotated = None
        self.last_frame_at = None
        self.capture_status = "starting"
        self.capture_error = None
        self.sse_clients = set()
        self.is_running = False
        self.last_p4_sequence = None

    def setup_routes(self):
        self.app.router.add_get("/status", self.handle_status)
        self.app.router.add_get("/events", self.handle_events)
        self.app.router.add_get("/snapshot.jpg", self.handle_snapshot)
        self.app.router.add_post("/enroll", self.handle_enroll)

    def status_payload(self):
        profiles = self.engine.load_owner_profiles() if self.engine is not None else []
        if self.capture_status == "online" and is_serial_device(self.device) and self.last_frame_at is not None:
            if time.time() - self.last_frame_at > P4_RESULT_MAX_AGE_SECONDS:
                self.mark_degraded("p4-inference-stale")
        online = self.capture_status == "online"
        result = self.latest_result if online else None
        owner_names = [] if self.engine is None else [profile["name"] for profile in profiles]
        if result is not None:
            owner_names = [
                face["face_id"]["user"]
                for face in result["faces"]
                if face["face_id"]["unlocked"] and face["face_id"]["user"]
            ]
        return {
            "status": self.capture_status,
            "device": self.device,
            "capture": {
                "width": self.width,
                "height": self.height,
                "fps": self.fps,
                "last_frame_at": self.last_frame_at,
                "error": self.capture_error,
            },
            "owner_enrolled": bool(owner_names),
            "owners": owner_names,
            "latest_result": result,
        }

    def mark_degraded(self, error):
        self.capture_status = "camera-unavailable"
        self.capture_error = error
        self.latest_frame = None
        self.latest_result = None
        self.latest_annotated = None

    async def handle_status(self, request):
        return web.json_response(self.status_payload())

    async def handle_enroll(self, request):
        data = await request.json() if request.can_read_body else {}
        name = data.get("name", "Frad")
        if not isinstance(name, str) or not name or len(name) > 32 or "\n" in name or "\r" in name:
            return web.json_response({"ok": False, "message": "Owner name must be 1-32 characters."}, status=400)

        if is_serial_device(self.device):
            return web.json_response({
                "ok": False,
                "message": "Press the ESP32-P4 physical confirmation button to enroll the configured owner.",
            }, status=403)

        if self.capture_status != "online" or self.latest_frame is None:
            return web.json_response({"ok": False, "message": "No current camera frame"}, status=503)

        ok, message = self.engine.enroll_owner(name, self.latest_frame)
        return web.json_response({"ok": ok, "message": message})

    async def handle_snapshot(self, request):
        if self.capture_status != "online" or self.latest_annotated is None:
            return web.Response(text="No current camera frame", status=503)
        ok, encoded = cv2.imencode(".jpg", self.latest_annotated)
        if not ok:
            return web.Response(text="Encode failed", status=500)
        return web.Response(body=encoded.tobytes(), content_type="image/jpeg")

    async def handle_events(self, request):
        response = web.StreamResponse(
            status=200,
            reason="OK",
            headers={
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
            },
        )
        await response.prepare(request)
        queue = asyncio.Queue()
        self.sse_clients.add(queue)

        try:
            while True:
                result = await queue.get()
                payload = f"data: {json.dumps(result, ensure_ascii=False)}\n\n"
                await response.write(payload.encode("utf-8"))
        except asyncio.CancelledError:
            pass
        finally:
            self.sse_clients.discard(queue)

        return response

    def publish_result(self, result):
        for queue in list(self.sse_clients):
            try:
                queue.put_nowait(result)
            except asyncio.QueueFull:
                pass

    async def serial_capture_loop(self):
        if serial is None:
            self.mark_degraded("pyserial-not-installed")
            return

        self.is_running = True
        while self.is_running:
            try:
                ser = await asyncio.to_thread(serial.Serial, self.device, 115200, timeout=1.0)
            except Exception as e:
                self.mark_degraded(f"serial-open-failed: {e}")
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)
                continue

            self.capture_status = "no-frame"
            self.capture_error = None
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
                            self.mark_degraded("serial-read-timeout")
                        await asyncio.sleep(0.05)
                        continue

                    line = raw_line.decode("utf-8", errors="replace").strip()
                    if not (line.startswith("{") and line.endswith("}")):
                        continue

                    try:
                        meta = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    result = normalize_p4_inference_metadata(meta)
                    if result is None:
                        continue

                    if self.last_p4_sequence is not None and result["sequence"] <= self.last_p4_sequence:
                        continue

                    consecutive_failures = 0
                    self.last_p4_sequence = result["sequence"]
                    self.latest_result = result
                    self.last_frame_at = time.time()
                    self.capture_status = "online"
                    self.capture_error = None
                    self.publish_result(result)
            finally:
                ser.close()

            if self.is_running:
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)

    async def capture_loop(self):
        self.is_running = True
        self.device = resolve_device(self.device)
        if is_serial_device(self.device):
            await self.serial_capture_loop()
            return
        if self.engine is None:
            self.mark_degraded("local-face-engine-unavailable")
            return

        while self.is_running:
            try:
                cap = await asyncio.wait_for(
                    asyncio.to_thread(open_camera, self.device, self.width, self.height, self.fps),
                    timeout=CAMERA_OPEN_TIMEOUT_SECONDS,
                )
            except TimeoutError:
                self.mark_degraded("camera-open-timeout")
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)
                continue
            if not cap.isOpened():
                self.mark_degraded("camera-unavailable")
                cap.release()
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)
                continue

            self.capture_status = "no-frame"
            self.capture_error = None
            failures = 0
            try:
                while self.is_running:
                    try:
                        ok, frame = await asyncio.wait_for(
                            asyncio.to_thread(cap.read),
                            timeout=FRAME_READ_TIMEOUT_SECONDS,
                        )
                    except TimeoutError:
                        ok, frame = False, None
                    if not ok or frame is None:
                        failures += 1
                        if failures >= MAX_CONSECUTIVE_READ_FAILURES:
                            self.mark_degraded("camera-read-failed")
                            break
                        await asyncio.sleep(0.05)
                        continue

                    try:
                        result = self.engine.analyze_frame(frame)
                        annotated = self.engine.annotate_frame(frame, result)
                    except Exception:
                        self.mark_degraded("analysis-failed")
                        break

                    failures = 0
                    self.latest_frame = frame
                    self.latest_result = result
                    self.latest_annotated = annotated
                    self.last_frame_at = time.time()
                    self.capture_status = "online"
                    self.capture_error = None
                    self.publish_result(result)
                    await asyncio.sleep(0.03)
            finally:
                cap.release()

            if self.is_running:
                await asyncio.sleep(CAPTURE_RETRY_SECONDS)

    async def start(self):
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", self.port)
        await site.start()
        try:
            await self.capture_loop()
        finally:
            await runner.cleanup()


if __name__ == "__main__":
    asyncio.run(FaceAgentService().start())
