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

function killGroup(child) {
  if (process.platform === 'win32') { try { child.kill('SIGKILL') } catch {} }
  else { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
}

function createUserAppVerifier({ electronPath = process.execPath, timeoutMs = TIMEOUT_MS, spawnProcess = spawn } = {}) {
  return {
    verify(bundle) {
      const semanticBundle = bundle && typeof bundle === 'object' ? {
        html: bundle.html,
        manifest: bundle.manifest,
        revision: bundle.revision,
      } : bundle
      if (!semanticBundle || typeof semanticBundle.html !== 'string' || Buffer.byteLength(semanticBundle.html, 'utf8') > MAX_HTML_BYTES) return Promise.resolve({ ok: false, error: 'html-too-large' })
      let serialized
      try { serialized = JSON.stringify(semanticBundle) } catch { return Promise.resolve({ ok: false, error: 'invalid-bundle' }) }
      if (Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES) return Promise.resolve({ ok: false, error: 'bundle-too-large' })
      return new Promise((resolve) => {
        // The runner is a GUI process on Windows, where a piped stdin is not a
        // channel it can read: two files carry the bundle and the result, and the
        // streams stay as the POSIX path and as the record of why a child failed.
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-verify-'))
        const bundlePath = path.join(directory, 'bundle.json')
        const resultPath = path.join(directory, 'result.json')
        fs.writeFileSync(bundlePath, serialized, 'utf8')
        const child = spawnProcess(electronPath, [path.join(__dirname, 'user-app-verifier-runner.js'), bundlePath, resultPath], {
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        })
        let output = ''
        let errors = ''
        let outputTooLarge = false
        let settled = false
        const finish = (result) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          try { fs.rmSync(directory, { recursive: true, force: true }) } catch {}
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
        const detail = () => errors.trim().slice(-MAX_DETAIL_CHARACTERS)
        const timer = setTimeout(() => {
          killGroup(child)
          finish({ ok: false, error: 'verification-timeout', ...(detail() ? { detail: detail() } : {}) })
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
          if (settled) return
          try {
            const result = JSON.parse(reportedLine())
            if (!result || typeof result.ok !== 'boolean' || (code === 0) !== result.ok) throw new Error('invalid verifier result')
            finish(result)
          } catch {
            finish({ ok: false, error: 'verifier-exited-without-result', ...(detail() ? { detail: detail() } : {}) })
          }
        })
      })
    },
  }
}

module.exports = { createUserAppVerifier, MAX_INPUT_BYTES, MAX_HTML_BYTES, MAX_OUTPUT_BYTES }
