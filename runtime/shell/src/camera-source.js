const DEFAULT_DEVICE = '/dev/odk-p4-camera'
const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720
const MIN_FRAME_BYTES = 4096
const LOCK_FILE = '/tmp/odk-camera.lock'
const LOCK_WAIT_SECONDS = 20

function createCameraCaptureProvider({
  device = process.env.ODK_CAMERA_DEVICE || DEFAULT_DEVICE,
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
      return fs.readFileSync(framePath)
    } finally {
      try {
        fs.rmSync(dir, { recursive: true, force: true })
      } catch {
        // Temp cleanup must not fail the capture result.
      }
    }
  }

  return { width, height, minIntervalMs, maxFrameBytes, now, captureFrame, present: () => fs.existsSync(device) }
}

function createCameraSource(options = {}) {
  const provider = createCameraCaptureProvider(options)
  const { width, height, minIntervalMs, maxFrameBytes, now } = provider
  const { signal } = options
  let state = { status: 'unavailable', frame: null, capturedAt: null, width, height }
  let lastCaptureAt = 0
  let stopped = Boolean(signal?.aborted)
  const pending = new Set()
  const unavailable = () => ({ status: 'unavailable', frame: null, capturedAt: null, width, height })
  const cancel = () => { stopped = true; state = unavailable() }
  if (!stopped) signal?.addEventListener('abort', cancel, { once: true })

  async function runRefresh() {
    const nowMs = now()
    if (!provider.present()) {
      state = { status: 'unavailable', frame: null, capturedAt: null, width, height }
      return state
    }
    if (nowMs - lastCaptureAt < minIntervalMs) return state
    lastCaptureAt = nowMs
    try {
      const bytes = await provider.captureFrame()
      if (bytes.length < MIN_FRAME_BYTES || bytes.length > maxFrameBytes) throw new Error(`rejected camera frame (${bytes.length} bytes)`)
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('camera frame is not a JPEG')
      const frame = `data:image/jpeg;base64,${bytes.toString('base64')}`
      if (!stopped) state = { status: 'live', frame, capturedAt: nowMs, width, height }
    } catch {
      if (!stopped) state = unavailable()
    }
    return state
  }

  function refresh() {
    if (stopped) return Promise.resolve(state)
    let resolve
    let reject
    const operation = new Promise((yes, no) => { resolve = yes; reject = no })
    pending.add(operation)
    operation.then(() => pending.delete(operation), () => pending.delete(operation))
    // Provider callbacks can stop the source before acquisition returns.
    runRefresh().then(resolve, reject)
    return operation
  }

  function stop() {
    cancel()
    signal?.removeEventListener('abort', cancel)
    return Promise.allSettled([...pending]).then(() => {})
  }

  return { refresh, snapshot: () => state, stop }
}

module.exports = { createCameraSource, createCameraCaptureProvider }
