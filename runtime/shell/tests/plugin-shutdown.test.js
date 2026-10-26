const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { installPluginShutdown } = require('../src/plugin-shutdown')
const { createPluginHost } = require('../src/plugin-host')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function application() {
  const app = new EventEmitter()
  app.exits = 0
  app.quit = () => {
    const event = { prevented: false, preventDefault() { this.prevented = true } }
    app.emit('before-quit', event)
    if (!event.prevented) app.exits++
    return event
  }
  return app
}

test('normal exit waits for one shared plugin shutdown', async () => {
  const app = application()
  const cleanup = deferred()
  const settled = deferred()
  let stops = 0
  installPluginShutdown(app, { stop() { stops++; return cleanup.promise } }, assert.fail)
  assert.equal(app.quit().prevented, true)
  assert.equal(app.quit().prevented, true)
  assert.equal(stops, 1)
  assert.equal(app.exits, 0)
  app.once('before-quit', settled.resolve)
  cleanup.resolve()
  await settled.promise
  assert.equal(app.exits, 1)
  assert.equal(app.listenerCount('before-quit'), 0)
})

test('shutdown errors are reported before exit resumes', async () => {
  for (const synchronous of [false, true]) {
    const app = application()
    const cleanup = deferred()
    const exited = deferred()
    const events = []
    const error = new Error('cleanup unavailable')
    installPluginShutdown(app, { stop() { if (synchronous) throw error; return cleanup.promise } }, failure => events.push(failure))
    app.quit()
    app.once('before-quit', () => { events.push('exit'); exited.resolve() })
    if (!synchronous) cleanup.reject(error)
    await exited.promise
    assert.deepEqual(events, [error, 'exit'])
    assert.equal(app.exits, 1)
  }
})

test('a failed diagnostic callback cannot reject the shutdown continuation', async () => {
  const app = application()
  const exited = deferred()
  const cleanup = deferred()
  installPluginShutdown(app, { stop: () => cleanup.promise }, () => { throw new Error('diagnostics unavailable') })
  app.quit()
  app.once('before-quit', exited.resolve)
  cleanup.reject(new Error('stop failed'))
  await exited.promise
  assert.equal(app.exits, 1)
})

test('exit immediately cancels plugin startup and waits for its resources', async () => {
  const app = application()
  const starting = deferred()
  const cleanup = deferred()
  const stopped = deferred()
  const events = []
  let signal
  const host = createPluginHost()
  host.register({
    manifest: { schemaVersion: 1, id: 'odk.test.shutdown', name: 'Shutdown', version: '1.0.0', kind: 'service', host: 'electron-main' },
    create(ctx) {
      signal = ctx.signal
      starting.resolve()
      return { async start() { await cleanup.promise }, stop() { events.push('stop') }, destroy() { events.push('destroy') } }
    },
  })
  const startup = host.start()
  await starting.promise
  installPluginShutdown(app, host, assert.fail)
  app.quit()
  assert.equal(signal.aborted, true)
  assert.equal(app.exits, 0)
  app.once('before-quit', () => { events.push('exit'); stopped.resolve() })
  cleanup.resolve()
  await startup
  await stopped.promise
  assert.deepEqual(events, ['stop', 'destroy', 'exit'])
  assert.equal(app.exits, 1)
})


test('explicit smoke status survives cleanup and repeated requests', async () => {
  for (const code of [0, 1]) {
    const app = application()
    const cleanup = deferred()
    const exited = deferred()
    const codes = []
    let stops = 0
    app.exit = value => { codes.push(value); exited.resolve() }
    const requestExit = installPluginShutdown(app, { stop() { stops++; return cleanup.promise } }, assert.fail)
    requestExit(code)
    requestExit(1 - code)
    assert.equal(stops, 1)
    assert.deepEqual(codes, [])
    cleanup.resolve()
    await exited.promise
    assert.deepEqual(codes, [code])
    assert.equal(app.listenerCount('before-quit'), 0)
  }
})

test('smoke cleanup rejection or throw reports failure and exits once', async () => {
  for (const synchronous of [false, true]) {
    const app = application()
    const cleanup = deferred()
    const exited = deferred()
    const events = []
    const error = Error('cleanup failed')
    app.exit = code => { events.push(code); exited.resolve() }
    const requestExit = installPluginShutdown(app, { stop() { if (synchronous) throw error; return cleanup.promise } }, value => events.push(value))
    requestExit(0)
    if (!synchronous) cleanup.reject(error)
    await exited.promise
    assert.deepEqual(events, [error, 1])
  }
})

test('smoke cleanup deadline fails closed without an unbounded wait', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const app = application()
  const cleanup = deferred()
  const failures = []
  const codes = []
  app.exit = code => codes.push(code)
  const requestExit = installPluginShutdown(app, { stop: () => cleanup.promise }, error => failures.push(error.message))
  requestExit(0)
  t.mock.timers.tick(4999)
  assert.deepEqual(codes, [])
  t.mock.timers.tick(1)
  assert.deepEqual(codes, [1])
  assert.deepEqual(failures, ['plugin shutdown timed out'])
  cleanup.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(codes, [1])
})


test('smoke rejects retained resources from the actual plugin Host', async () => {
  const app = application()
  const exited = deferred()
  const failures = []
  const codes = []
  const host = createPluginHost({ onError() {} })
  host.register({
    manifest: { schemaVersion: 1, id: 'odk.test.retained', name: 'Retained', version: '1.0.0', kind: 'service', host: 'electron-main' },
    create() { return { stop() { throw Error('owned resource is still pending') } } },
  })
  await host.start()
  app.exit = code => { codes.push(code); exited.resolve() }
  const requestExit = installPluginShutdown(app, host, error => failures.push(error.message))
  requestExit(0)
  await exited.promise
  assert.equal(host.list()[0].state, 'cleanup-failed')
  assert.deepEqual(codes, [1])
  assert.deepEqual(failures, ['plugin shutdown retained resources'])
})

test('a smoke request bounds an already pending normal shutdown', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const app = application()
  const cleanup = deferred()
  const failures = []
  const codes = []
  let stops = 0
  app.exit = code => codes.push(code)
  const requestExit = installPluginShutdown(app, { stop() { stops++; return cleanup.promise } }, error => failures.push(error.message))
  app.quit()
  requestExit(1)
  assert.equal(stops, 1)
  t.mock.timers.tick(5000)
  assert.deepEqual(codes, [1])
  assert.deepEqual(failures, ['plugin shutdown timed out'])
  cleanup.resolve()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(codes, [1])
})
