import os

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
