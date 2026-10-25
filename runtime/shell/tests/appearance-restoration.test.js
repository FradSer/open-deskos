'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fs = require('node:fs/promises')
const os = require('node:os')
const execute = require('node:util').promisify(require('node:child_process').execFile)

test('actual Electron activates and restores signed Appearance through authenticated CLI and preserves rendered themes', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-ap-'))
  const env = { ...process.env, ODK_APPEARANCE_ROOT: root }
  delete env.ELECTRON_RUN_AS_NODE
  const operation = execute(require('electron'), isolatedElectronArgs([path.join(__dirname, 'native-appearance-electron.cjs')]),
    { env, signal: t.signal, timeout: 25000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
  const closed = new Promise(resolve => operation.child.once('close', resolve))
  try {
    const result = await operation
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
      ok: true, signedAppearance: true, failedEntry: false, invalidPort: false, emptyStartup: false,
      capturedMutation: true, comparisonThemes: 3, runtimeActivation: process.platform !== 'win32', runtimeRecovery: process.platform !== 'win32',
    })
  } finally { await closed; await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})

test('actual Electron activates Appearance without startup signed assets or document navigation', { timeout: 30000, skip: process.platform === 'win32' }, async t => {
  const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-ap-'))
  const env = { ...process.env, ODK_APPEARANCE_ROOT: root }
  delete env.ELECTRON_RUN_AS_NODE
  const operation = execute(require('electron'), isolatedElectronArgs([path.join(__dirname, 'native-appearance-electron.cjs'), '--empty-startup']),
    { env, signal: t.signal, timeout: 25000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
  const closed = new Promise(resolve => operation.child.once('close', resolve))
  try {
    const result = await operation
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
      ok: true, signedAppearance: true, failedEntry: false, invalidPort: false, emptyStartup: true,
      capturedMutation: false, comparisonThemes: 3, runtimeRecovery: true, runtimeActivation: true,
    })
  } finally { await closed; await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
