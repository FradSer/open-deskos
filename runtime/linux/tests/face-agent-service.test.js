const test = require('node:test')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const fs = require('node:fs')

const source = fs.readFileSync('../../experiments/vision/face-agent/face_service.py', 'utf8')

test('Face Agent accepts inference only from the stable ESP32-P4 serial device', () => {
  assert.match(source, /DEFAULT_DEVICE = "\/dev\/open-deskos-p4-camera"/)
  assert.match(source, /raise ValueError\("Face Agent accepts only the ESP32-P4 camera serial device"\)/)
  assert.match(source, /serial\.Serial, self\.device, 115200, timeout=1\.0/)
  assert.doesNotMatch(source, /cv2/)
  assert.doesNotMatch(source, /VideoCapture/)
  assert.doesNotMatch(source, /\/dev\/video0/)
  assert.doesNotMatch(source, /FaceAgentEngine/)
})

test('Face Agent health exposes no-frame and camera-unavailable without a result', () => {
  assert.match(source, /self\.capture_status = "starting"/)
  assert.match(source, /self\.capture_status = "no-frame"/)
  assert.match(source, /self\.capture_status = "camera-unavailable"/)
  assert.match(source, /"latest_result": self\.latest_result if self\.capture_status == "online" else None/)
  assert.match(source, /asyncio\.wait_for\(/)
  assert.match(source, /FRAME_READ_TIMEOUT_SECONDS/)
})

test('Face Agent serial mode forwards only on-device inference metadata', () => {
  assert.match(source, /"source": "esp32p4_on_device_inference"/)
  assert.match(source, /def normalize_p4_inference_metadata/)
  assert.match(source, /if not isinstance\(meta, dict\) or meta\.get\("v"\) != 1/)
  assert.match(source, /"faces_count": len\(normalized_faces\)/)
  assert.match(source, /"landmarks": normalized_landmarks/)
  assert.match(source, /self\.app\.router\.add_get\("\/status", self\.handle_status\)/)
  assert.match(source, /self\.device != DEFAULT_DEVICE/)
  assert.match(source, /P4_RESULT_MAX_AGE_SECONDS/)
  assert.match(source, /self\.last_p4_sequence = None\n            consecutive_failures = 0/)
  assert.match(source, /result\["sequence"\] <= self\.last_p4_sequence/)
  assert.doesNotMatch(source, /add_post\("\/enroll"/)
  assert.doesNotMatch(source, /add_get\("\/events"/)
  assert.doesNotMatch(source, /add_get\("\/snapshot\.jpg"/)
})

test('Face Agent service overlay remains valid Python without local vision dependencies', () => {
  const result = childProcess.spawnSync('python3', ['-m', 'py_compile', '../../experiments/vision/face-agent/face_service.py'], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
})
