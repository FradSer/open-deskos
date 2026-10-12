const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { cleanup, runCommand } = require('./helpers/hydra-wire-lifecycle')

test('cancelled MQTT callback wait still closes the owned endpoint before removing state', { timeout: 100 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-hydra-close-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const controller = new AbortController()
  controller.abort(Error('Controlled cancellation'))
  let closed = false
  const host = { stop: () => new Promise(() => {}) }
  const broker = { async stop() { assert.equal(fs.existsSync(root), true); closed = true } }
  await assert.rejects(cleanup(host, broker, root, controller.signal), /Controlled cancellation/)
  assert.equal(closed, true)
  assert.equal(fs.existsSync(root), false)
})

test('failed endpoint release preserves owned fixture state', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-hydra-close-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  await assert.rejects(cleanup({ stop: async () => {} }, { stop: async () => { throw Error('Uncertain endpoint release') } },
    root, new AbortController().signal), /Uncertain endpoint release/)
  assert.equal(fs.existsSync(root), true)
})

test('command argument refusal retains its original error without a child to join', async () => {
  await assert.rejects(runCommand(null, [], {}), error => error.code === 'ERR_INVALID_ARG_TYPE')
})

test('cancelled command joins its child before private state can be removed', { timeout: 10000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-command-close-'))
  const marker = path.join(root, 'pid')
  const controller = new AbortController()
  let watcher
  const ready = new Promise(resolve => {
    watcher = fs.watch(root, () => {
      try {
        const value = fs.readFileSync(marker, 'utf8')
        if (/^\d+$/.test(value)) resolve(Number(value))
      } catch (error) { if (error.code !== 'ENOENT') throw error }
    })
  })
  const operation = runCommand(process.execPath, ['-e',
    "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", marker],
    { signal: controller.signal, timeout: 5000 })
  const rejected = assert.rejects(operation, error => error.name === 'AbortError')
  try {
    const pid = await Promise.race([ready, operation])
    controller.abort(Error('Controlled command cancellation'))
    await rejected
    assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH')
    assert.equal(fs.existsSync(root), true)
  } finally {
    controller.abort()
    await operation.catch(() => {})
    watcher.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
