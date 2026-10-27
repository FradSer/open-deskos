const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')

for (const ok of [true, false]) {
  test(`smoke ${ok ? 'success' : 'failure'} runs before-quit hooks and waits for plugin cleanup`, async () => {
    const { EventEmitter } = require('node:events')
    const { installPluginShutdown } = require('../src/plugin-shutdown')
    const { createPluginHost } = require('../src/plugin-host')
    const { createNativeRendererAssets } = require('../src/native-renderer-assets')
    const { setTimeout: delay } = require('node:timers/promises')
    const calls = []
    let releaseCleanup
    let exited
    const cleanup = new Promise(resolve => { releaseCleanup = resolve })
    const exit = new Promise(resolve => { exited = resolve })
    const app = new EventEmitter()
    app.quit = () => {
      const event = { prevented: false, preventDefault() { this.prevented = true } }
      app.emit('before-quit', event)
      if (!event.prevented) calls.push(['normal-exit'])
    }
    app.exit = code => { calls.push(['electron-exit', code]); exited() }
    const assets = createNativeRendererAssets()
    const nativeRendererAssets = { close() { calls.push(['native-close']); assets.close() } }
    const finishSource = source.slice(source.indexOf('function finishSmoke('), source.indexOf('function runSmokeCheck('))
    const hooks = source.match(/app.once\('before-quit', \(\) => \{ stopping = true \}\)/)[0]
      + '\n' + source.match(/app.once\('before-quit', \(\) => nativeRendererAssets.close\(\)\)/)[0]
    const context = vm.createContext({
      app, nativeRendererAssets,
      writeSmokeResult: result => calls.push(['result', result.ok]),
      setTimeout: callback => callback(),
    })
    vm.runInContext('let stopping = false\n' + hooks + '\n' + finishSource, context)
    const host = createPluginHost()
    let signal
    let resourceCancelled
    const cancelled = new Promise(resolve => { resourceCancelled = resolve })
    host.register({
      manifest: { schemaVersion: 1, id: 'odk.test.smoke-cleanup', name: 'Smoke cleanup', version: '1.0.0', kind: 'service', host: 'electron-main' },
      create(ctx) {
        signal = ctx.signal
        const pendingTimer = delay(60000, undefined, { signal }).catch(error => {
          assert.equal(error.name, 'AbortError')
          calls.push(['timer-cancelled'])
          resourceCancelled()
        })
        ctx.onCleanup(() => calls.push(['resource-release']))
        return {
          async stop() { calls.push(['stop']); await pendingTimer; await cleanup; calls.push(['cleanup-finished']) },
          destroy() { calls.push(['destroy']) },
        }
      },
    })
    await host.start()
    const requestExit = installPluginShutdown(app, host, assert.fail)
    try {
      context.finishSmoke({ ok }, requestExit)
      assert.equal(vm.runInContext('stopping', context), true)
      assert.equal(signal.aborted, true)
      assert.throws(() => assets.fork(), /assets are closed/)
      await cancelled
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(calls.filter(([event]) => event === 'stop').length, 1)
      assert.equal(calls.some(([event]) => event === 'electron-exit' || event === 'cleanup-finished'), false)
      releaseCleanup()
      await exit
      const order = event => calls.findIndex(([name]) => name === event)
      assert.deepEqual(calls[0], ['result', ok])
      assert.ok(order('native-close') < order('stop'))
      assert.ok(order('timer-cancelled') < order('cleanup-finished'))
      assert.ok(order('cleanup-finished') < order('destroy'))
      assert.ok(order('destroy') < order('resource-release'))
      assert.ok(order('resource-release') < order('electron-exit'))
      assert.deepEqual(calls.filter(([event]) => event === 'electron-exit'), [['electron-exit', ok ? 0 : 1]])
    } finally { releaseCleanup(); await host.stop() }
    assert.match(source, /const requestExit = installPluginShutdown\(app, pluginHost,/)
    assert.match(source, /runSmokeCheck\(win, \{ width: options.width, height: options.height \}, requestExit\)/)
  })
}

test('smoke mode does not construct Remote Bridge socket state', () => {
  assert.match(source, /const smokeMode = process\.argv\.includes\('--smoke'\)/)
  assert.match(source, /if \(!smokeMode\) \{\n    try \{\n      remoteSocketPath = resolveRemoteBridgeSocketPath\(process\.env, shellHost\)/)
  assert.match(source, /'system.remote-link': \{ create: createRemoteBridgeClient, smokeMode, options: \{ socketPath: remoteSocketPath, host: shellHost \} \}/)
})

test('normal Shell shutdown uses the plugin cleanup barrier', () => {
  assert.match(source, /const \{ installPluginShutdown \} = require\('\.\/plugin-shutdown'\)/)
  assert.match(source, /installPluginShutdown\(app, pluginHost,/)
  assert.doesNotMatch(source, /void pluginHost\.stop\(\)/)
})

test('renderer diagnosis removes destroyed frames without accessing the destroyed window', () => {
  const start = source.indexOf('  const win = createWindow(options)')
  const end = source.indexOf('\n  if (options.smoke)', start)
  const setup = source.slice(start, end)
  let destroyed = false
  let onDestroyed
  const webContents = { once(event, callback) { assert.equal(event, 'destroyed'); onDestroyed = callback } }
  const win = { get webContents() {
    if (destroyed) throw Error('Object has been destroyed')
    return webContents
  } }
  const diagnosisFrames = new Set()
  vm.runInNewContext(setup, { createWindow: () => win, options: {}, diagnosisFrames })
  assert.equal(diagnosisFrames.has(webContents), true)
  destroyed = true
  onDestroyed()
  assert.equal(diagnosisFrames.size, 0)
})

test('smoke settles once when load and deadline callbacks race', () => {
  const checkSource = source.slice(source.indexOf('function runSmokeCheck('), source.indexOf('async function main()'))
  for (const first of ['timeout', 'load']) {
    const results = []
    let onLoad
    let onTimeout
    const context = vm.createContext({
      setTimeout(callback, delay) { assert.equal(delay, 15000); onTimeout = callback; return 1 },
      clearTimeout() {},
      finishSmoke: result => results.push(result),
    })
    vm.runInContext(checkSource, context)
    context.runSmokeCheck({
      webContents: { once(event, callback) { assert.equal(event, 'did-finish-load'); onLoad = callback } },
      getContentBounds: () => ({ width: 1280, height: 800 }),
    }, { width: 1280, height: 800 })
    if (first === 'timeout') { onTimeout(); onLoad() }
    else { onLoad(); onTimeout() }
    assert.equal(results.length, 1)
    assert.equal(results[0].ok, first === 'load')
  }
})


test('a smoke result write failure reports failure and still uses the shutdown barrier', async () => {
  const { EventEmitter } = require('node:events')
  const { installPluginShutdown } = require('../src/plugin-shutdown')
  const calls = []
  let exited
  const exit = new Promise(resolve => { exited = resolve })
  const app = new EventEmitter()
  app.quit = () => { app.emit('before-quit', { preventDefault() {} }) }
  app.exit = code => { calls.push(['exit', code]); exited() }
  app.once('before-quit', () => calls.push(['before-quit']))
  const requestExit = installPluginShutdown(app, { stop() { calls.push(['stop']); return Promise.resolve() } }, assert.fail)
  const finishSource = source.slice(source.indexOf('function finishSmoke('), source.indexOf('function runSmokeCheck('))
  const context = vm.createContext({
    app, setTimeout: callback => callback(),
    writeSmokeResult() { throw Error('/private/fixture-output-path') },
    console: { error: message => calls.push(['report', message]) },
  })
  vm.runInContext(finishSource, context)
  assert.doesNotThrow(() => context.finishSmoke({ ok: true }, requestExit))
  await exit
  assert.deepEqual(calls, [['report', 'smoke result could not be written'], ['before-quit'], ['stop'], ['exit', 1]])
})
