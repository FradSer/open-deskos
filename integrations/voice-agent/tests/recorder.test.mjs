import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record } from '../src/recorder.mjs'
import { createWebRtcVad } from '../src/vad.mjs'

function pcm(frames, sample = 0) {
  const data = Buffer.alloc(frames * 640)
  for (let i = 0; i < data.length; i += 2) data.writeInt16LE(sample, i)
  return data
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'voice-capture-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const child = new EventEmitter()
  child.stdout = new PassThrough({ highWaterMark: 640 })
  child.exitCode = null
  const calls = { args: [], signals: [], levels: [], frames: 0, freed: 0 }
  child.kill = signal => {
    calls.signals.push(signal)
    child.exitCode = 0
    child.stdout.end()
    setImmediate(() => child.emit('close', 0, null))
    return true
  }
  const capture = await record(directory, 'test-device', level => calls.levels.push(level), {
    spawnProcess: (_command, args) => {
      calls.args = args
      setImmediate(() => child.emit('spawn'))
      return child
    },
    createVad: async () => ({
      process: frame => {
        assert.equal(frame.length, 640)
        calls.frames++
        return options.classify?.(calls.frames) ?? false
      },
      close: () => { calls.freed++ },
    }),
    ...options.dependencies,
  })
  t.after(() => capture.cleanup())
  return { directory, child, calls, capture }
}

async function feed(child, data) {
  if (!child.stdout.write(data)) await once(child.stdout, 'drain')
  await new Promise(resolve => setImmediate(resolve))
}

test('pinned local WebRTC WASM classifies real silence and frees idempotently', async () => {
  const vad = await createWebRtcVad()
  for (let i = 0; i < 100; i++) assert.equal(vad.process(pcm(1)), false)
  assert.throws(() => vad.process(Buffer.alloc(639)), /Invalid voice activity frame/)
  vad.close()
  vad.close()
  assert.throws(() => vad.process(pcm(1)), /Invalid voice activity frame/)
})

test('capture startup failure frees VAD and temporary files', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-startup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let freed = 0
  await assert.rejects(record(directory, 'test', () => {}, {
    spawnProcess: () => {
      const child = new EventEmitter()
      child.kill = () => false
      setImmediate(() => { child.emit('error', Error('ENOENT')); child.emit('close', -2, null) })
      return child
    },
    createVad: async () => ({ process: () => false, close: () => { freed++ } }),
  }), /Microphone unavailable/)
  assert.equal(freed, 1)
  assert.deepEqual(await readdir(directory), [])
})

test('capture streams indefinite silence with no duration flag and finalizes a valid WAV', async t => {
  const { directory, child, calls, capture } = await fixture(t)
  assert.ok(!calls.args.includes('-d'))
  assert.equal(calls.args[calls.args.indexOf('-t') + 1], 'raw')
  for (let i = 0; i < 1601; i++) await feed(child, pcm(1))
  assert.equal(calls.signals.length, 0)
  const path = await capture.stop()
  await capture.done
  assert.equal(calls.frames, 1601)
  const wav = await readFile(path)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(4), wav.length - 8)
  assert.equal(wav.readUInt32LE(24), 16000)
  assert.equal(wav.readUInt16LE(22), 1)
  assert.equal(wav.readUInt16LE(34), 16)
  assert.equal(wav.readUInt32LE(40), 1601 * 640)
  await Promise.all([capture.cleanup(), capture.cleanup(), capture.stop()])
  assert.deepEqual(calls.signals, ['SIGINT'])
  assert.equal(calls.freed, 1)
  assert.deepEqual(await readdir(directory), [])
})

test('speech followed by 60 silent frames endpoints once and speech resets silence', async t => {
  const { child, calls, capture } = await fixture(t, { classify: frame => frame === 4 || frame === 63 })
  await feed(child, pcm(122))
  assert.equal(calls.signals.length, 0)
  await feed(child, pcm(1))
  await capture.done
  assert.deepEqual(calls.signals, ['SIGINT'])
  const wav = await readFile(await capture.stop())
  assert.equal(wav.readUInt32LE(40), 123 * 640)
})

test('partial PCM frames produce measured RMS every 100ms', async t => {
  const { child, calls, capture } = await fixture(t)
  const data = pcm(10, 16384)
  await feed(child, data.subarray(0, 13))
  assert.equal(calls.levels.length, 0)
  await feed(child, data.subarray(13))
  assert.deepEqual(calls.levels, [0.5, 0.5])
  await feed(child, pcm(5))
  assert.deepEqual(calls.levels, [0.5, 0.5, 0])
  const wav = await readFile(await capture.stop())
  assert.deepEqual(wav.subarray(44), Buffer.concat([data, pcm(5)]))
})

test('disk backpressure pauses capture rather than accumulating audio', async t => {
  let release
  let writes = 0
  const { child, capture } = await fixture(t, { dependencies: {
    createOutput: path => {
      const output = createWriteStream(path)
      return new Writable({ highWaterMark: 640,
        write(chunk, _encoding, callback) {
          writes++
          if (writes === 2) release = () => output.write(chunk, callback)
          else output.write(chunk, callback)
        },
        final(callback) { output.end(callback) },
      })
    },
  } })
  child.stdout.write(pcm(1))
  while (!release) await new Promise(resolve => setImmediate(resolve))
  let accepted = true
  let count = 0
  while (accepted && count++ < 1000) accepted = child.stdout.write(pcm(1))
  assert.equal(accepted, false)
  release()
  await capture.stop()
})

test('capture process failure rejects and cleanup is repeatable', async t => {
  const { directory, child, calls, capture } = await fixture(t)
  child.exitCode = 2
  child.stdout.end()
  child.emit('close', 2, null)
  await assert.rejects(capture.done, /Recording failed/)
  await Promise.all([capture.cleanup(), capture.cleanup()])
  assert.equal(calls.freed, 1)
  assert.deepEqual(await readdir(directory), [])
})

test('disk failure terminates capture and cleans VAD and temporary audio', async t => {
  const { directory, calls, capture } = await fixture(t, { dependencies: {
    createOutput: () => new Writable({ write(_chunk, _encoding, callback) { callback(Error('Disk full')) } }),
  } })
  await assert.rejects(capture.done)
  await capture.cleanup()
  assert.equal(calls.freed, 1)
  assert.equal(calls.signals.length, 1)
  assert.deepEqual(await readdir(directory), [])
})
