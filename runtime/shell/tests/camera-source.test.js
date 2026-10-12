const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const { createCameraSource, createCameraCaptureProvider } = require('../src/camera-source')

test('Camera capture capability returns raw bytes without source construction or eager capture', async () => {
  const files = new Map()
  let calls = 0
  const provider = createCameraCaptureProvider({ device: '/synthetic/camera',
    fsImpl: { existsSync: () => true, mkdtempSync: prefix => prefix + 'provider',
      readFileSync: target => files.get(target), rmSync: () => files.clear() },
    execFileImpl: async (command, args) => {
      calls++
      assert.equal(command, 'flock')
      assert.ok(args.includes('/synthetic/camera'))
      assert.ok(args.includes('--set-fmt-video=width=1280,height=720,pixelformat=MJPG'))
      files.set(streamTarget(args), JPEG)
    },
  })
  assert.equal(calls, 0)
  assert.equal(provider.present(), true)
  assert.deepEqual(await provider.captureFrame(), JPEG)
  assert.equal(calls, 1)
  assert.equal(files.size, 0)
})

const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.alloc(8192, 0x11),
  Buffer.from([0xff, 0xd9]),
])

test('pre-aborted Camera source starts no capture and repeated stop remains safe', async () => {
  const controller = new AbortController()
  controller.abort()
  const { source, calls, removed } = harness({ extra: { signal: controller.signal } })
  assert.equal((await source.refresh()).status, 'unavailable')
  await Promise.all([source.stop(), source.stop()])
  assert.equal(calls.length, 0)
  assert.equal(removed.length, 0)
  assert.equal(source.snapshot().frame, null)
})

function streamTarget(args) {
  const flag = args.find((arg) => arg.startsWith('--stream-to='))
  return flag ? flag.slice('--stream-to='.length) : null
}

function harness({ onExec, exists = new Set(['/dev/video0']), extra = {}, now = () => 1700000000000 } = {}) {
  const files = new Map()
  const removed = []
  const calls = []
  const fsImpl = {
    existsSync: (entry) => exists.has(entry),
    mkdtempSync: (prefix) => `${prefix}camera-test`,
    readFileSync: (entry) => {
      if (!files.has(entry)) throw new Error(`missing ${entry}`)
      return files.get(entry)
    },
    rmSync: (entry) => {
      removed.push(entry)
      for (const key of [...files.keys()]) {
        if (key === entry || key.startsWith(`${entry}/`)) files.delete(key)
      }
    },
  }
  const execFileImpl = onExec || (async (cmd, args) => {
    calls.push({ cmd, args })
    files.set(streamTarget(args), JPEG)
  })
  const source = createCameraSource({
    device: '/dev/video0',
    execFileImpl,
    fsImpl,
    now,
    ...extra,
  })
  return { source, calls, removed }
}

test('live capture returns a data URL frame with capture time', async () => {
  const { source, calls } = harness()
  const state = await source.refresh()
  assert.equal(state.status, 'live')
  assert.ok(state.frame.startsWith('data:image/jpeg;base64,'))
  assert.equal(state.capturedAt, 1700000000000)
  assert.equal(state.width, 1280)
  assert.equal(state.height, 720)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'flock')
  assert.ok(calls[0].args.includes('v4l2-ctl'))
  assert.ok(calls[0].args.includes('/dev/video0'))
  assert.deepEqual(source.snapshot(), state)
})

test('capture failure reports unavailable and removes temp files', async () => {
  const { source, removed } = harness({
    onExec: async () => { throw new Error('no camera') },
  })
  const state = await source.refresh()
  assert.equal(state.status, 'unavailable')
  assert.equal(state.frame, null)
  assert.ok(removed.length > 0)
})

test('missing device reports unavailable without spawning capture', async () => {
  const { source, calls } = harness({ exists: new Set() })
  const state = await source.refresh()
  assert.equal(state.status, 'unavailable')
  assert.equal(state.frame, null)
  assert.equal(calls.length, 0)
})

test('non-JPEG captures are rejected without a frame', async () => {
  const { source } = harness({
    onExec: async (_cmd, args) => {},
  })
  const state = await source.refresh()
  assert.equal(state.status, 'unavailable')
  assert.equal(state.frame, null)
})

test('oversized captures are rejected without a frame', async () => {
  const { source } = harness({ extra: { maxFrameBytes: 16 } })
  const state = await source.refresh()
  assert.equal(state.status, 'unavailable')
  assert.equal(state.frame, null)
})

test('captures are throttled to the minimum interval', async () => {
  let clock = 1700000000000
  const { source, calls } = harness({ now: () => clock })
  await source.refresh()
  clock += 1000
  await source.refresh()
  assert.equal(calls.length, 1)
  clock += 15000
  await source.refresh()
  assert.equal(calls.length, 2)
})
