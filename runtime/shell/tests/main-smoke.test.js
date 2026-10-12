const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')

test('smoke completion exits after writing its result instead of waiting for Electron cleanup', () => {
  assert.match(source, /function finishSmoke\(result\)/)
  assert.match(source, /writeSmokeResult\(result\)/)
  const finishSource = source.slice(source.indexOf('function finishSmoke(result)'), source.indexOf('function runSmokeCheck('))
  for (const ok of [true, false]) {
    const calls = []
    const context = vm.createContext({
      writeSmokeResult: result => calls.push(['result', result.ok]),
      setTimeout: callback => callback(),
      app: { exit: code => calls.push(['electron-exit', code]) },
      process: { exit: code => calls.push(['node-exit', code]) },
    })
    vm.runInContext(finishSource, context)
    context.finishSmoke({ ok })
    assert.deepEqual(calls, [['result', ok], ['electron-exit', ok ? 0 : 1]])
  }
  assert.match(source, /finishSmoke\(\{ ok, width: actual\.width, height: actual\.height \}\)/)
})

test('smoke mode does not construct Remote Bridge socket state', () => {
  assert.match(source, /const smokeMode = process\.argv\.includes\('--smoke'\)/)
  assert.match(source, /if \(!smokeMode\) \{\n    try \{\n      remoteSocketPath = resolveRemoteBridgeSocketPath\(\)/)
  assert.match(source, /'system.remote-link': \{ create: createRemoteBridgeClient, smokeMode, options: \{ socketPath: remoteSocketPath \} \}/)
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
