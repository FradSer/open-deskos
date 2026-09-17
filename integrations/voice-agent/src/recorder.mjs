import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWebRtcVad } from './vad.mjs'

function wavHeader(bytes) {
  if (bytes > 0xffffffff - 36) throw Error('WAV size limit exceeded')
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(bytes + 36, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(bytes, 40)
  return header
}

function analyzeFrames(vad, onLevel, endpoint) {
  const frame = Buffer.alloc(640)
  let used = 0
  let spoken = false
  let silence = 0
  let ended = false
  let frames = 0
  let energy = 0
  return chunk => {
    for (let offset = 0; offset < chunk.length;) {
      const length = Math.min(640 - used, chunk.length - offset)
      chunk.copy(frame, used, offset, offset + length)
      used += length
      offset += length
      if (used !== 640) continue
      used = 0
      const speech = vad.process(frame)
      spoken ||= speech
      silence = speech ? 0 : silence + 1
      for (let i = 0; i < 320; i++) energy += (frame.readInt16LE(i * 2) / 32768) ** 2
      if (++frames % 5 === 0) { onLevel(Math.sqrt(energy / 1600)); energy = 0 }
      if (!ended && spoken && silence >= 60) { ended = true; endpoint() }
    }
  }
}

function trackProcess(child) {
  let stopped = false
  let exited = false
  let timer
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      exited = true
      clearTimeout(timer)
      if (code === 0 || (stopped && (signal === 'SIGINT' || code === 1))) resolve(undefined)
      else reject(Error('Recording failed'))
    })
  })
  void done.catch(() => {})
  return { done, stop() {
    if (stopped || exited) return
    stopped = true
    child.kill('SIGINT')
    timer = setTimeout(() => child.kill('SIGKILL'), 2000)
    timer.unref()
  } }
}

async function streamWav(child, path, vad, onLevel, process, createOutput) {
  let bytes = 0
  const analyze = analyzeFrames(vad, onLevel, () => process.stop())
  const frames = new Transform({
    construct(callback) { this.push(wavHeader(0)); callback() },
    transform(chunk, _encoding, callback) {
      try {
        bytes += chunk.length
        if (bytes > 0xffffffff - 36) throw Error('WAV size limit exceeded')
        analyze(chunk)
        callback(null, chunk)
      } catch (error) { callback(error) }
    },
  })
  try {
    const output = createOutput(path, { mode: 0o600 })
    const streaming = pipeline(child.stdout, frames, output).catch(error => { process.stop(); throw error })
    const results = await Promise.allSettled([streaming, process.done])
    for (const result of results) if (result.status === 'rejected') throw result.reason
    if (bytes % 2 !== 0) throw Error('Incomplete microphone sample')
    const file = await open(path, 'r+')
    try { await file.write(wavHeader(bytes), 0, 44, 0) } finally { await file.close() }
  } finally {
    process.stop()
    await process.done.catch(() => {})
    vad.close()
  }
}

export async function record(directory, device = 'default', onLevel = _level => {}, {
  spawnProcess = spawn, createVad = createWebRtcVad, createOutput = createWriteStream,
} = {}) {
  const temporary = await mkdtemp(join(directory, 'capture-'))
  const path = join(temporary, 'audio.wav')
  let vad
  let child
  let process
  try {
    vad = await createVad()
    child = spawnProcess('arecord', ['-q', '-D', device, '-t', 'raw', '-f', 'S16_LE', '-r', '16000', '-c', '1'], { stdio: ['ignore', 'pipe', 'ignore'] })
    process = trackProcess(child)
    await new Promise((resolve, reject) => {
      child.once('spawn', () => resolve(undefined))
      child.once('error', reject)
    })
  } catch {
    process?.stop()
    await process?.done.catch(() => {})
    vad?.close()
    await rm(temporary, { recursive: true, force: true })
    throw Error('Microphone unavailable')
  }
  const done = streamWav(child, path, vad, onLevel, process, createOutput)
  void done.catch(() => {})
  const stop = async () => { process.stop(); await done; return path }
  let cleaning
  return {
    done,
    stop,
    cleanup: () => {
      cleaning ??= (async () => {
        try { await stop() } catch { /* Failed captures still require removal. */ }
        await rm(temporary, { recursive: true, force: true })
      })()
      return cleaning
    },
  }
}
