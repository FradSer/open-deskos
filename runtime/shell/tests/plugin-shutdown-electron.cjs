'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const { createPluginHost } = require('../src/plugin-host')
const { installPluginShutdown } = require('../src/plugin-shutdown')

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-plugin-shutdown-'))
app.setPath('userData', profile)
let completed = false
let stops = 0
let requests = 0
let window
let windowClosed = false
let releaseCleanup
const cleanup = new Promise(resolve => { releaseCleanup = resolve })

app.on('will-quit', () => {
  assert.equal(completed, true)
  assert.equal(stops, 1)
  assert.equal(requests, 3)
  assert.equal(windowClosed, true)
  assert.equal(window.isDestroyed(), true)
  console.log('Electron plugin shutdown: passed')
})
process.on('exit', () => {
  fs.rmSync(profile, { recursive: true, force: true })
  if (!completed) process.exitCode = 1
})

app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false })
  window.on('close', () => { assert.equal(completed, true) })
  window.on('closed', () => { windowClosed = true })
  const host = createPluginHost()
  host.register({
    manifest: { schemaVersion: 1, id: 'odk.test.shutdown', name: 'Shutdown', version: '1.0.0', kind: 'service', host: 'electron-main' },
    create() {
      return {
        async stop() { stops++; await cleanup },
        destroy() { completed = true },
      }
    },
  })
  await host.start()
  installPluginShutdown(app, host, error => { throw error })
  app.on('before-quit', event => {
    requests++
    assert.equal(event.defaultPrevented, !completed)
  })
  app.quit()
  app.quit()
  assert.equal(completed, false)
  assert.equal(window.isDestroyed(), false)
  assert.equal(requests, 2)
  releaseCleanup()
}).catch(error => {
  console.error(error)
  app.exit(1)
})
