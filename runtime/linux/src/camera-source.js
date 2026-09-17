const DEFAULT_DEVICE = '/dev/open-deskos-p4-camera'
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720
const MIN_FRAME_BYTES = 4096
const LOCK_FILE = '/tmp/odk-camera.lock'
const LOCK_WAIT_SECONDS = 20

function createCameraSource({
  device = process.env.ODESK_CAMERA_DEVICE || DEFAULT_DEVICE,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  minIntervalMs = 10000,
  maxFrameBytes = 512 * 1024,
  execFileImpl,
  fsImpl,
  now = () => Date.now(),
} = {}) {
  const path = require('node:path')
  const os = require('node:os')
  const childProcess = require('node:child_process')
  const fs = fsImpl || require('node:fs')
  const execFile = execFileImpl || ((cmd, args) => new Promise((resolve, reject) => {
    childProcess.execFile(cmd, args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) reject(error)
      else resolve({ stdout, stderr })
    })
  }))

  let state = { status: 'unavailable', frame: null, capturedAt: null, width, height }
  let lastCaptureAt = 0

  async function captureFrame() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-camera-'))
    const framePath = path.join(dir, 'frame.mjpg')
    try {
      // One streamer at a time: concurrent v4l2-ctl sessions on a single
      // UVC function collide on STREAMON/teardown and yield torn frames.
      await execFile('flock', [
        '-w', String(LOCK_WAIT_SECONDS), LOCK_FILE,
        'v4l2-ctl',
        '-d', device,
        `--set-fmt-video=width=${width},height=${height},pixelformat=MJPG`,
        '--stream-mmap',
        '--stream-count=1',
        `--stream-to=${framePath}`,
      ])
      const bytes = fs.readFileSync(framePath)
      if (bytes.length < MIN_FRAME_BYTES || bytes.length > maxFrameBytes) {
        throw new Error(`rejected camera frame (${bytes.length} bytes)`)
      }
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        throw new Error('camera frame is not a JPEG')
      }
      return `data:image/jpeg;base64,${bytes.toString('base64')}`
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // Temp cleanup must not fail the capture result.
      }
    }
  }

  async function refresh() {
    const nowMs = now()
    if (!fs.existsSync(device)) {
      state = { status: 'unavailable', frame: null, capturedAt: null, width, height }
      return state
    }
    if (nowMs - lastCaptureAt < minIntervalMs) return state
    lastCaptureAt = nowMs
    try {
      const frame = await captureFrame()
      state = { status: 'live', frame, capturedAt: nowMs, width, height }
    } catch {
      state = { status: 'unavailable', frame: null, capturedAt: null, width, height }
    }
    return state
  }

  return { refresh, snapshot: () => state }
}

module.exports = { createCameraSource }
