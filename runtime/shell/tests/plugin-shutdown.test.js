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
