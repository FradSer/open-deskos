'use strict'

const { spawn } = require('node:child_process')
const path = require('node:path')
const TIMEOUT_MS = 8000
const MAX_INPUT_BYTES = 1024 * 1024
const MAX_HTML_BYTES = 256 * 1024
const MAX_OUTPUT_BYTES = 64 * 1024

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
        const child = spawnProcess(electronPath, [path.join(__dirname, 'user-app-verifier-runner.js')], {
          stdio: ['pipe', 'pipe', 'ignore'],
          detached: process.platform !== 'win32',
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        })
        let output = ''
        let outputTooLarge = false
        let settled = false
        const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result) }
        const timer = setTimeout(() => {
          killGroup(child)
          finish({ ok: false, error: 'verification-timeout' })
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
        child.on('error', (error) => finish({ ok: false, error: error.message }))
        child.on('close', (code) => {
          if (settled) return
          const line = output.trim().split('\n').filter(Boolean).pop()
          try {
            const result = JSON.parse(line)
            if (!result || typeof result.ok !== 'boolean' || (code === 0) !== result.ok) throw new Error('invalid verifier result')
            finish(result)
          } catch { finish({ ok: false, error: 'verifier-exited-without-result' }) }
        })
        child.stdin.on('error', () => {})
        child.stdin.end(serialized)
      })
    },
  }
}

module.exports = { createUserAppVerifier, MAX_INPUT_BYTES, MAX_HTML_BYTES, MAX_OUTPUT_BYTES }
