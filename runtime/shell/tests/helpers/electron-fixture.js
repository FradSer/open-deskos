const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function runFixture(file, args = [], { timeout = 120000, spawn = spawnSync } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-e2e-child-'))
  try {
    const result = spawn(process.execPath, [path.join(__dirname, 'electron-fixture-runner.cjs'), profile,
      path.resolve(__dirname, '..', file), ...args], { stdio: 'inherit', timeout })
    // A timed-out child can handle its termination signal and still exit zero.
    // Keep the diagnostic, but do not let that exit pass the E2E aggregate.
    return result.status === 0 && (result.error || result.signal) ? { ...result, status: 1 } : result
  } finally {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

module.exports = { runFixture }
