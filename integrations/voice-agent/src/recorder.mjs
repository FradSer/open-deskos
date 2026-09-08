import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'

export async function record(directory, device = 'default') {
  const temporary = await mkdtemp(join(directory, 'capture-'))
  const path = join(temporary, 'audio.wav')
  const child = spawn('arecord', ['-q', '-D', device, '-t', 'wav', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-d', '30', path], { stdio: 'ignore' })
  let stopped = false
  const done = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (code === 0 || (stopped && (signal === 'SIGINT' || code === 1))) resolve(undefined)
      else reject(Error('Recording failed'))
    })
  })
  void done.catch(() => {})
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', () => resolve(undefined))
      child.once('error', reject)
    })
  } catch {
    await rm(temporary, { recursive: true, force: true })
    throw Error('Microphone unavailable')
  }
  async function stop() {
    stopped = true
    if (child.exitCode === null) child.kill('SIGINT')
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000)
    try { await done } finally { clearTimeout(timer) }
    return path
  }
  return {
    done,
    stop,
    cleanup: async () => {
      try { await stop() } catch { /* Removal must also run after capture failure. */ }
      await rm(temporary, { recursive: true, force: true })
    },
  }
}
