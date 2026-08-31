const test = require('node:test')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')

const source = fs.readFileSync('../../experiments/vision/face-agent/face_service.py', 'utf8')

test('Face Agent service defaults to standard UVC camera format', () => {
  assert.match(source, /DEFAULT_DEVICE = "\/dev\/video0"/)
  assert.match(source, /DEFAULT_WIDTH = 640/)
  assert.match(source, /DEFAULT_HEIGHT = 480/)
  assert.match(source, /DEFAULT_FPS = 30/)
  assert.match(source, /cv2\.VideoCapture\(device, cv2\.CAP_V4L2\)/)
  assert.match(source, /cv2\.VideoWriter_fourcc\(\*"MJPG"\)/)
  assert.match(source, /cap\.set\(cv2\.CAP_PROP_FRAME_WIDTH, width\)/)
  assert.match(source, /cap\.set\(cv2\.CAP_PROP_FRAME_HEIGHT, height\)/)
  assert.match(source, /cap\.set\(cv2\.CAP_PROP_FPS, fps\)/)
})

test('Face Agent health exposes no-frame and camera-unavailable without a result', () => {
  assert.match(source, /self\.capture_status = "starting"/)
  assert.match(source, /self\.capture_status = "no-frame"/)
  assert.match(source, /self\.capture_status = "camera-unavailable"/)
  assert.match(source, /result = self\.latest_result if online else None/)
  assert.match(source, /"latest_result": result/)
  assert.match(source, /asyncio\.wait_for\(/)
  assert.match(source, /CAMERA_OPEN_TIMEOUT_SECONDS/)
  assert.match(source, /FRAME_READ_TIMEOUT_SECONDS/)
})

test('Face Agent serial mode forwards only on-device inference metadata', () => {
  assert.match(source, /"source": "esp32p4_on_device_inference"/)
  assert.match(source, /def normalize_p4_inference_metadata/)
  assert.match(source, /if not isinstance\(meta, dict\) or meta\.get\("v"\) != 1/)
  assert.match(source, /"faces_count": len\(normalized_faces\)/)
  assert.match(source, /"landmarks": normalized_landmarks/)
  assert.match(source, /self\.engine = None if is_serial_device\(self\.device\) else FaceAgentEngine\(\)/)
  assert.match(source, /P4_RESULT_MAX_AGE_SECONDS/)
  assert.match(source, /result\["sequence"\] <= self\.last_p4_sequence/)
  assert.match(source, /Press the ESP32-P4 physical confirmation button to enroll the configured owner/)
})

test('Face Agent service overlay remains valid Python without local vision dependencies', () => {
  const result = childProcess.spawnSync('python3', ['-m', 'py_compile', '../../experiments/vision/face-agent/face_service.py'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
})
