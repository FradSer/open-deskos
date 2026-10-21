'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { surfaceTimeouts } = require('./helpers/weather-selection')
const execFile = require('node:util').promisify(require('node:child_process').execFile)

test('default and signed independent Weather preserve the actual rendered Widget', { timeout: surfaceTimeouts().test }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-weather-render-'))
  const env = { ...process.env, ODK_WEATHER_FIXTURE_PROFILE: profile, ODK_CONFIG_DIR: path.join(profile, 'config'),
    XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    await require('./helpers/weather-selection').install(profile, env, { signal: t.signal })
    const file = path.join(__dirname, 'weather-plugin-electron.cjs')
    await fs.access(file)
    const operation = execFile(require('electron'), [`--user-data-dir=${profile}`, file], { env, timeout: surfaceTimeouts().child, signal: t.signal, killSignal: 'SIGKILL' })
    const closed = new Promise(resolve => operation.child.once('close', resolve))
    let result
    try { result = await operation } finally { await closed }
    const report = JSON.parse(result.stdout.trim().split('\n').pop())
    assert.deepEqual(report, { ok: true, actualPreload: true, signedIndependent: true, themes: 4, sizes: 5, states: 6 })
  } finally { await fs.rm(profile, { recursive: true, force: true }) }
})
