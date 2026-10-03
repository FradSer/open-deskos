import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { record } from '../src/recorder.mjs'

const DIRECTSHOW_DEVICE = 'Microphone (2- USB Audio Device)'

function pcm(frames, sample = 0) {
  const data = Buffer.alloc(frames * 640)
  for (let i = 0; i < data.length; i += 2) data.writeInt16LE(sample, i)
  return data
}

async function fixture(t, { platform, device = 'test-device', classify, onQuit, onKill, ...dependencies } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'voice-win32-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const child = new EventEmitter()
  child.stdout = new PassThrough({ highWaterMark: 640 })
  child.exitCode = null
  const calls = { command: '', args: [], stdio: [], signals: [], writes: [], levels: [], frames: 0, freed: 0 }
  const finish = (code, signal = null) => {
    child.exitCode = code
    child.stdout.end()
    setImmediate(() => child.emit('close', code, signal))
  }
  child.stdin = new Writable({ write(chunk, _encoding, callback) {
    calls.writes.push(chunk.toString())
    callback()
    const quit = onQuit ?? (() => finish(0))
    quit(child, calls.writes.length)
  } })
  child.kill = signal => {
    calls.signals.push(signal)
    const terminate = onKill ?? (() => finish(0, signal))
    terminate(child, signal)
    return true
  }
  const capture = await record(directory, device, level => calls.levels.push(level), {
    ...(platform === undefined ? {} : { platform }),
    spawnProcess: (command, args, options) => {
      calls.command = command
      calls.args = args
      calls.stdio = options.stdio
      setImmediate(() => child.emit('spawn'))
      return child
    },
    createVad: async () => ({
      process: frame => {
        assert.equal(frame.length, 640)
        calls.frames++
        return classify?.(calls.frames) ?? false
      },
      close: () => { calls.freed++ },
    }),
    ...dependencies,
  })
  t.after(() => capture.cleanup())
  return { directory, child, calls, capture }
}

async function feed(child, data) {
  if (!child.stdout.write(data)) await once(child.stdout, 'drain')
  await new Promise(resolve => setImmediate(resolve))
}

test('a Windows host captures DirectShow audio through ffmpeg with the operator device name verbatim', async t => {
  const { calls, capture } = await fixture(t, { platform: 'win32', device: DIRECTSHOW_DEVICE })
  assert.equal(calls.command, 'ffmpeg')
  assert.deepEqual(calls.args, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'dshow', '-i', `audio=${DIRECTSHOW_DEVICE}`,
    '-ac', '1', '-ar', '16000',
    '-f', 's16le', 'pipe:1',
  ])
  assert.deepEqual(calls.stdio, ['pipe', 'pipe', 'ignore'])
  // The operator device name reaches DirectShow as one unmodified argument.
  assert.deepEqual(calls.args.filter(argument => argument.includes('USB Audio Device')), [`audio=${DIRECTSHOW_DEVICE}`])
  await capture.stop()
})

test('a Windows stop asks ffmpeg to quit on stdin instead of sending a signal', async t => {
  const { child, calls, capture } = await fixture(t, { platform: 'win32' })
  await feed(child, pcm(1))
  await capture.stop()
  assert.deepEqual(calls.writes, ['q\n'])
  assert.deepEqual(calls.signals, [])
})

test('a Windows capture that ignores the quit command is terminated after the two second grace period', async t => {
  const { calls, child, capture } = await fixture(t, { platform: 'win32', onQuit: () => {},
    onKill: (child, signal) => {
      child.exitCode = null
      child.stdout.end()
      setImmediate(() => child.emit('close', null, signal))
    } })
  await feed(child, pcm(1))
  const path = await capture.stop()
  assert.deepEqual(calls.writes, ['q\n'])
  assert.deepEqual(calls.signals, ['SIGKILL'])
  const wav = await readFile(path)
  assert.equal(wav.length, 44 + 640)
  assert.equal(wav.readUInt32LE(40), 640)
})

test('an ffmpeg exit after our quit is a successful stop while an unexpected crash is a failed capture', async t => {
  const quieted = await fixture(t, { platform: 'win32', onQuit: child => {
    child.exitCode = 255
    child.stdout.end()
    setImmediate(() => child.emit('close', 255, null))
  } })
  await feed(quieted.child, pcm(1))
  assert.equal((await readFile(await quieted.capture.stop())).readUInt32LE(40), 640)
  await quieted.capture.done
  assert.deepEqual(quieted.calls.writes, ['q\n'])

  const crashed = await fixture(t, { platform: 'win32' })
  crashed.child.exitCode = 1
  crashed.child.stdout.end()
  crashed.child.emit('close', 1, null)
  // A crash before the desk asked for a stop, and before any audio arrived, is the
  // same fact a missing device is: this host has no microphone to capture from.
  await assert.rejects(crashed.capture.done, /Microphone unavailable/)
  assert.deepEqual(crashed.calls.writes, [])
  await crashed.capture.cleanup()
  assert.deepEqual(await readdir(crashed.directory), [])
})

test('a Windows host without ffmpeg reports an unavailable microphone and removes the capture directory', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'voice-win32-startup-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let freed = 0
  await assert.rejects(record(directory, DIRECTSHOW_DEVICE, () => {}, {
    platform: 'win32',
    spawnProcess: (command, args, options) => {
      assert.equal(command, 'ffmpeg')
      assert.deepEqual(options.stdio, ['pipe', 'pipe', 'ignore'])
      const child = new EventEmitter()
      child.stdin = new Writable({ write(_chunk, _encoding, callback) { callback() } })
      child.kill = () => false
      setImmediate(() => { child.emit('error', Error('spawn ffmpeg ENOENT')); child.emit('close', -2, null) })
      return child
    },
    createVad: async () => ({ process: () => false, close: () => { freed++ } }),
  }), /Microphone unavailable/)
  assert.equal(freed, 1)
  assert.deepEqual(await readdir(directory), [])
})

test('a Linux host and the default platform still capture through arecord with an ignored stdin', async t => {
  for (const options of [{ platform: 'linux' }, {}]) {
    const { calls, capture } = await fixture(t, { ...options, device: 'plughw:1,0' })
    assert.equal(calls.command, 'arecord')
    assert.deepEqual(calls.args, ['-q', '-D', 'plughw:1,0', '-t', 'raw', '-f', 'S16_LE', '-r', '16000', '-c', '1'])
    assert.deepEqual(calls.stdio, ['ignore', 'pipe', 'ignore'])
    await capture.stop()
    assert.deepEqual(calls.signals, ['SIGINT'])
    assert.deepEqual(calls.writes, [])
  }
})

for (const platform of ['linux', 'win32']) {
  test(`${platform} capture streams a 44-byte RIFF header, 20 ms frames and a measured RMS level every 5 frames`, async t => {
    const { child, calls, capture } = await fixture(t, { platform })
    const data = pcm(10, 16384)
    await feed(child, data.subarray(0, 13))
    assert.equal(calls.levels.length, 0)
    await feed(child, data.subarray(13))
    assert.deepEqual(calls.levels, [0.5, 0.5])
    assert.equal(calls.frames, 10)
    await capture.stop()
    const wav = await readFile(await capture.stop())
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
    assert.equal(wav.readUInt32LE(4), wav.length - 8)
    assert.equal(wav.readUInt32LE(24), 16000)
    assert.equal(wav.readUInt32LE(28), 32000)
    assert.equal(wav.readUInt16LE(22), 1)
    assert.equal(wav.readUInt16LE(34), 16)
    assert.equal(wav.readUInt32LE(40), 10 * 640)
    assert.equal(wav.length, 44 + 10 * 640)
  })

  test(`${platform} capture endpoints once after 60 silent frames and removes the capture directory`, async t => {
    const { directory, child, calls, capture } = await fixture(t, { platform, classify: frame => frame === 4 })
    await feed(child, pcm(1))
    assert.deepEqual(calls.writes, [])
    assert.equal(calls.signals.length, 0)
    await feed(child, pcm(63))
    await capture.done
    assert.equal(calls.frames, 64)
    if (platform === 'win32') assert.deepEqual(calls.writes, ['q\n'])
    else assert.deepEqual(calls.signals, ['SIGINT'])
    const wav = await readFile(await capture.stop())
    assert.equal(wav.readUInt32LE(40), 64 * 640)
    await Promise.all([capture.cleanup(), capture.cleanup(), capture.stop()])
    assert.equal(calls.freed, 1)
    assert.deepEqual(await readdir(directory), [])
  })

  test(`${platform} capture failure rejects and cleanup is repeatable and quiet`, async t => {
    const { directory, child, calls, capture } = await fixture(t, { platform })
    child.exitCode = 2
    child.stdout.end()
    child.emit('close', 2, null)
    // A capture that ended before the desk asked it to is classified by whether any
    // audio arrived: a Windows host that opened no device says the microphone is
    // unavailable, and a Unix host keeps reporting the failed recording it always did.
    await assert.rejects(capture.done, platform === 'win32' ? /Microphone unavailable/ : /Recording failed/)
    await Promise.all([capture.cleanup(), capture.cleanup()])
    assert.equal(calls.freed, 1)
    assert.deepEqual(await readdir(directory), [])
  })
}

test('a Windows capture with an odd trailing sample still refuses to finalize a truncated WAV', async t => {
  const { directory, child, capture } = await fixture(t, { platform: 'win32' })
  await feed(child, pcm(1))
  await feed(child, Buffer.from([0x01]))
  await assert.rejects(capture.stop(), /Incomplete microphone sample/)
  await capture.cleanup()
  assert.deepEqual(await readdir(directory), [])
})

// A device that never opened a microphone is not a recording that failed, and an
// operator looking at the audio path would not find the one declaration that names
// the microphone. This is what a Windows host reported for a device name that does
// not exist: ffmpeg exits 1 before a single sample, and ffmpeg's own reason was
// invisible because the capture's standard error is not part of the status.
test('a Windows capture that opens no device reports the microphone as unavailable', async t => {
  const { directory, child, calls, capture } = await fixture(t, { platform: 'win32' })
  // ffmpeg could not find the input device and exited before any audio arrived.
  child.exitCode = 1
  child.stdout.end()
  setImmediate(() => child.emit('close', 1, null))
  await assert.rejects(capture.done, /Microphone unavailable/)
  assert.deepEqual(calls.writes, [], 'the desk never asked a capture that had already ended')
  await capture.cleanup()
  assert.deepEqual(await readdir(directory), [])
})

test('a Windows capture that ends after audio keeps reporting a failed recording', async t => {
  const { directory, child, capture } = await fixture(t, { platform: 'win32' })
  await feed(child, pcm(2))
  child.exitCode = 2
  child.stdout.end()
  setImmediate(() => child.emit('close', 2, null))
  // Audio did arrive, so this is a capture that failed rather than a device that
  // never opened, and the distinction is the one the status can carry.
  await assert.rejects(capture.done, /Recording failed/)
  await capture.cleanup()
  assert.deepEqual(await readdir(directory), [])
})

test('a Unix capture that opens no device keeps reporting a failed recording', async t => {
  const { directory, child, capture } = await fixture(t, { platform: 'linux' })
  child.exitCode = 1
  child.stdout.end()
  setImmediate(() => child.emit('close', 1, null))
  await assert.rejects(capture.done, /Recording failed/)
  await capture.cleanup()
  assert.deepEqual(await readdir(directory), [])
})
