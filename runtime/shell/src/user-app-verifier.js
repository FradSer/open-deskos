'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const TIMEOUT_MS = 8000
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_HTML_BYTES = 256 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_DETAIL_CHARACTERS = 2000
const CLEANUP_RETRY_LIMIT = 40
const CLEANUP_RETRY_DELAY_MS = 50

function killGroup(child) {
  if (!child?.pid) return
  if (process.platform === 'win32') { try { child.kill('SIGKILL') } catch {} }
  else { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
}

function createUserAppVerifier({ electronPath = process.execPath, timeoutMs = TIMEOUT_MS, spawnProcess = spawn } = {}) {
  // A failure verdict can settle before the terminated child actually closes.
  const children = new Set()
  let stopped = false
  const drain = () => Promise.all([...children])
  return {
    drain,
    async close() {
      stopped = true
      await drain()
    },
    verify(bundle, { signal } = {}) {
      if (stopped) return Promise.resolve({ ok: false, error: 'verification-aborted' })
      const semanticBundle = bundle && typeof bundle === 'object' ? {
        html: bundle.html,
        manifest: bundle.manifest,
        revision: bundle.revision,
      } : bundle
      if (!semanticBundle || typeof semanticBundle.html !== 'string' || Buffer.byteLength(semanticBundle.html, 'utf8') > MAX_HTML_BYTES) return Promise.resolve({ ok: false, error: 'html-too-large' })
      let serialized
      try { serialized = JSON.stringify(semanticBundle) } catch { return Promise.resolve({ ok: false, error: 'invalid-bundle' }) }
      if (Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES) return Promise.resolve({ ok: false, error: 'bundle-too-large' })
      if (signal?.aborted) return Promise.resolve({ ok: false, error: 'verification-aborted' })
      let directory
      try { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-verify-')) } catch (error) {
        return Promise.resolve({ ok: false, error: error.message })
      }
      const bundlePath = path.join(directory, 'bundle.json')
      const resultPath = path.join(directory, 'result.json')
      const profilePath = path.join(directory, 'profile')
      try { fs.writeFileSync(bundlePath, serialized, 'utf8') } catch (error) {
        try { fs.rmSync(directory, { recursive: true, force: true }) } catch {}
        return Promise.resolve({ ok: false, error: error.message })
      }
      return new Promise((resolve) => {
        // The runner is a GUI process on Windows, where a piped stdin is not a
        // channel it can read: files carry the bundle, result and private profile.
        let output = ''
        let errors = ''
        let outputTooLarge = false
        let settled = false
        let child = null
        let timer = null
        let abortHandler = null
        let cleanupTimer = null
        let cleanupAttempts = 0
        let cleaned = false
        const cleanup = ({ restart = false } = {}) => {
          if (cleaned) return
          if (restart) {
            if (cleanupTimer) clearTimeout(cleanupTimer)
            cleanupTimer = null
            cleanupAttempts = 0
          }
          try {
            fs.rmSync(directory, { recursive: true, force: true })
            cleaned = true
            if (cleanupTimer) clearTimeout(cleanupTimer)
          } catch {
            if (cleanupAttempts++ < CLEANUP_RETRY_LIMIT) {
              cleanupTimer = setTimeout(() => {
                cleanupTimer = null
                cleanup()
              }, CLEANUP_RETRY_DELAY_MS)
              cleanupTimer.unref?.()
            }
          }
        }
        const finish = (result) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          if (signal && abortHandler) signal.removeEventListener('abort', abortHandler)
          cleanup()
          resolve(result)
        }
        // The last result-looking line, from the file the runner was told to write
        // and then from its stdout.
        const reportedLine = () => {
          try {
            const fromFile = fs.readFileSync(resultPath, 'utf8').trim()
            if (fromFile) return fromFile.split('\n').filter(Boolean).pop()
          } catch {}
          return output.trim().split('\n').filter(Boolean).pop()
        }
        // A failure file is written by the trusted runner. Success still requires
        // its normal exit; stdout cannot establish a failure before process exit.
        const reportedFailure = () => {
          try {
            if (fs.statSync(resultPath).size > MAX_OUTPUT_BYTES) return null
            const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
            if (result?.ok === false && typeof result.error === 'string' && result.error.trim()) {
              return { ok: false, error: result.error }
            }
          } catch { /* Missing or incomplete result files do not prove failure. */ }
          return null
        }
        const detail = () => errors.trim().slice(-MAX_DETAIL_CHARACTERS)
        abortHandler = () => {
          killGroup(child)
          finish({ ok: false, error: 'verification-aborted' })
        }
        if (signal) signal.addEventListener('abort', abortHandler, { once: true })
        let releaseChild
        const closure = new Promise(resolve => { releaseChild = resolve })
        children.add(closure)
        const childClosed = () => { children.delete(closure); releaseChild() }
        try {
          const runnerPath = path.join(__dirname, 'user-app-verifier-runner.js')
          // A disposable macOS verifier does not need background maintenance.
          // Chromium reads this switch when its thread pool starts, before JS.
          const args = [`--user-data-dir=${profilePath}`, runnerPath, bundlePath, resultPath, profilePath]
          if (process.platform === 'darwin') args.push('--disable-best-effort-tasks')
          child = spawnProcess(electronPath, args, {
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
            env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
          })
          if (child && typeof child.once === 'function') child.once('close', childClosed)
          else childClosed()
          if (!child || typeof child.on !== 'function' || !child.stdout?.on) throw new Error('verifier spawn failed')
          if (settled) {
            killGroup(child)
            child.once?.('close', () => cleanup({ restart: true }))
            return
          }
          timer = setTimeout(() => {
            killGroup(child)
            finish(reportedFailure() || { ok: false, error: 'verification-timeout', ...(detail() ? { detail: detail() } : {}) })
          }, timeoutMs)
          child.stdout.on('data', (chunk) => {
            if (outputTooLarge) return
            output += chunk.toString()
            if (Buffer.byteLength(output, 'utf8') > MAX_OUTPUT_BYTES) {
              outputTooLarge = true
              killGroup(child)
              finish({ ok: false, error: 'verifier-output-too-large' })
            }
          })
          child.stderr?.on('data', (chunk) => {
            if (errors.length < MAX_DETAIL_CHARACTERS) errors += chunk.toString()
          })
          child.on('error', (error) => finish({ ok: false, error: error.message }))
          child.on('close', (code) => {
            if (settled) { cleanup({ restart: true }); return }
            try {
              const result = JSON.parse(reportedLine())
              if (!result || typeof result.ok !== 'boolean' || (code === 0) !== result.ok) throw new Error('invalid verifier result')
              finish(result)
            } catch {
              finish({ ok: false, error: 'verifier-exited-without-result', ...(detail() ? { detail: detail() } : {}) })
            }
          })
          if (signal?.aborted) abortHandler()
        } catch (error) {
          if (!child) childClosed()
          killGroup(child)
          finish({ ok: false, error: error.message })
        }
      })
    },
  }
}

module.exports = { createUserAppVerifier, MAX_INPUT_BYTES, MAX_HTML_BYTES, MAX_OUTPUT_BYTES }
