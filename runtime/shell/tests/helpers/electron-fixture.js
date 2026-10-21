const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function runFixture(file, args = [], { timeout = 120000, spawn = spawnSync } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-e2e-child-'))
  try {
    return spawn(process.execPath, [path.join(__dirname, 'electron-fixture-runner.cjs'), profile,
      path.resolve(__dirname, '..', file), ...args], { stdio: 'inherit', timeout })
  } finally {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

module.exports = { runFixture }
