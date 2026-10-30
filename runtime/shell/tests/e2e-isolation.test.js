const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const { runFixture, isolatedElectronArgs } = require('./helpers/electron-fixture')

// Automated private browser fixtures opt in explicitly. Capability probes and production
// verifier consumers keep their own contracts; manual live acceptance is outside this inventory.
const nativeLaunchExceptions = new Set(['runtime-dependencies.test.js', 'plugin-cli-management.test.js', 'user-app-runtime.test.js'])
const nativeLaunchFiles = [
  ...fs.readdirSync(__dirname).filter(file => file.endsWith('.test.js')).map(file => path.join(__dirname, file)),
  path.join(__dirname, 'acceptance/agent-task-pipeline.test.cjs'),
]
for (const file of nativeLaunchFiles) {
  const source = fs.readFileSync(file, 'utf8')
  if (nativeLaunchExceptions.has(path.basename(file))) continue
  const aliases = [...source.matchAll(/\b(?:const|let)\s+([\w$]+)\s*=\s*require\(['"]electron['"]\)/g)].map(match => match[1])
  const electronArgument = ["require\\(['\"]electron['\"]\\)", ...aliases].join('|')
  const calls = [...source.matchAll(new RegExp(`\\b(?:runCommand|execute|execFile|run|spawn|spawnSync)\\(\\s*(?:${electronArgument})\\s*,\\s*`, 'g'))]
  if (!calls.length) continue
  test(`isolated native launch opts into shared policy: ${path.relative(__dirname, file)}`, () => {
    for (const call of calls) {
      assert.ok(source.slice(call.index + call[0].length).startsWith('isolatedElectronArgs('),
        `${path.relative(__dirname, file)} must bind the policy in its initial process arguments`)
    }
  })
}

test('generic commands and actual runtime capability probes retain their original policy', () => {
  for (const file of ['helpers/hydra-wire-lifecycle.js', 'runtime-dependencies.test.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /isolatedElectronArgs|disable-best-effort-tasks/)
  }
})

for (const platform of ['darwin', 'linux', 'win32']) {
  test(`isolated fixture launch defers only macOS best-effort work: ${platform}`, () => {
    const original = ['fixture.cjs', '--theme=pixel']
    const actual = isolatedElectronArgs(original, platform)
    assert.deepEqual(original, ['fixture.cjs', '--theme=pixel'])
    assert.deepEqual(actual, platform === 'darwin' ? [...original, '--disable-best-effort-tasks'] : original)
    assert.deepEqual(isolatedElectronArgs(actual, platform), actual)
    assert.equal(actual.some(value => value === '--no-sandbox' || value === '--single-process'), false)
    runFixture('widget-density.cjs', ['--theme=pixel'], { platform, timeout: 1234, spawn(_executable, args, options) {
      assert.equal(path.basename(args[0]), 'electron-fixture-runner.cjs')
      assert.equal(args[2], path.join(__dirname, 'widget-density.cjs'))
      assert.equal(args[3], '--theme=pixel')
      assert.equal(options.timeout, 1234)
      assert.equal(args.includes('--disable-best-effort-tasks'), platform === 'darwin')
      return { status: 0, signal: null }
    } })
  })
}

test('App Manager uses the isolated initial argv policy without changing command execution', () => {
  const source = fs.readFileSync(path.join(__dirname, 'app-manager-electron.test.js'), 'utf8')
  assert.match(source, /runCommand\(require\('electron'\), isolatedElectronArgs\(/)
  assert.match(source, /timeout: 35000/)
  assert.match(source, /fixtureRejection\(error,/)
})

test('geometry includes isolated connection and gamepad status replacements', () => {
  const { scripts } = require('../package.json')
  assert.match(scripts.geometry, /node --test --test-concurrency=1 tests\/input-status-surface-electron\.test\.js(?:$| &&)/)
})

test('geometry includes the isolated Quota surface replacement matrix', () => {
  const { scripts } = require('../package.json')
  assert.match(scripts.geometry, /node --test --test-concurrency=1 tests\/quota-surface-electron\.test\.js(?:$| &&)/)

})

test('geometry includes the isolated Pi State Bar replacement matrix', () => {
  const { scripts } = require('../package.json')
  assert.match(scripts.geometry, /node --test --test-concurrency=1 tests\/pi-status-surface-electron\.test\.js(?:$| &&)/)
})

test('geometry includes the isolated desk tool replacement matrix', () => {
  const { scripts } = require('../package.json')
  assert.match(scripts.geometry, /node --test --test-concurrency=1 tests\/desk-tool-surface-electron\.test\.js(?:$| &&)/)
})

test('geometry includes the isolated calendar and State Bar replacement matrix', () => {
  const { scripts } = require('../package.json')
  assert.match(scripts.geometry, /node --test --test-concurrency=1 tests\/calendar-surface-electron\.test\.js(?:$| &&)/)
})


test('keyboard fixtures do not request desktop window focus', () => {
  for (const file of ['page-indicator.cjs', 'pixel-font.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    assert.doesNotMatch(source, /win(?:\.webContents)?\.focus\(/, file)
    assert.match(source, /Emulation\.setFocusEmulationEnabled/, file)
  }
})

test('E2E launches every child through the isolated fixture launcher', () => {
  const source = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8')
  assert.doesNotMatch(source, /spawnSync\(/)
  assert.match(source, /runFixture/)
  assert.match(source, /process\.once\('exit', cleanupProfile\)/)
  assert.match(source, /app\.setPath\('sessionData', homeTestProfile\)/)
})

test('Windows profile locks cannot prevent E2E or indicator termination', () => {
  for (const file of ['e2e.js', 'page-indicator.cjs']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    const start = source.indexOf('const cleanupProfile =')
    const end = source.indexOf('\napp.', start)
    assert.ok(start >= 0 && end > start, file)
    for (const platform of ['win32', 'darwin']) {
      const locked = Object.assign(Error('locked fixture profile'), { code: 'EBUSY' })
      const context = { homeTestProfile: 'owned-profile', profile: 'owned-profile',
        fs: { rmSync() { throw locked } }, process: { platform }, console: { warn() {} } }
      const run = () => vm.runInNewContext(`${source.slice(start, end)}\ncleanupProfile()`, context)
      if (platform === 'win32') assert.doesNotThrow(run, file)
      else assert.throws(run, error => error === locked, file)
    }
  }
})

test('Shell fixtures provide explicit empty development discovery', () => {
  for (const file of ['e2e.js', 'widget-app-styles.cjs', 'widget-sequential-refinement.cjs',
    'page-indicator.cjs', 'pixel-font.cjs', 'voice-input-ui.cjs', 'user-app-desktop.cjs', 'helpers/live-fixtures.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, file), 'utf8'), /odk-renderer-development-plugins/, file)
  }
})

test('standalone Shell fixtures provide current Remote Link state', () => {
  for (const file of ['e2e.js', 'page-indicator.cjs', 'personal-agent-status.cjs', 'personal-agent-floating-panel.cjs',
    'pi-sessions-states.cjs', 'proactive-jev-e2e.cjs', 'pi-overview-markdown.cjs', 'pixel-font.cjs',
    'user-app-desktop.cjs', 'pi-sessions-interaction.cjs', 'session-tabs-style.cjs', 'proactive-panel.cjs',
    'widget-sequential-refinement.cjs', 'user-app-context.cjs', 'voice-input-ui.cjs', 'widget-app-styles.cjs', 'weather-layout.cjs']) {
    assert.match(fs.readFileSync(path.join(__dirname, file), 'utf8'),
      /ipcMain\.handle\('odk-remote-link-state', \(\) => \(\{ state: 'disconnected', sequence: 0 \}\)\)/, file)
  }
})

test('desktop fixture registers each IPC handler once with its intended state', () => {
  const handlers = new Map()
  const file = path.join(__dirname, 'user-app-desktop.cjs')
  const localRequire = createRequire(file)
  const waiting = { then() { return this }, catch() { return this } }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname, console, process, setTimeout: () => 0, clearTimeout() {},
    require(name) {
      if (name !== 'electron') return localRequire(name)
      return { app: { on() {}, whenReady: () => waiting },
        protocol: { registerSchemesAsPrivileged() {} }, ipcMain: { handle(channel, callback) {
          assert.equal(handlers.has(channel), false, `duplicate ${channel}`)
          handlers.set(channel, callback)
        } } }
    },
  })
  assert.equal(handlers.size, 13)
  assert.equal(handlers.get('odk-personal-agent-consumer-ready')().accepted, false)
  assert.equal(handlers.get('odk-remote-link-state')().state, 'disconnected')
  assert.equal(handlers.get('odk-futu-holdings')().state, 'unavailable')
  assert.equal(handlers.get('odk-weather-status')().status, 'unconfigured')
  assert.equal(handlers.get('odk-camera-frame')().state, 'unavailable')
  assert.equal(handlers.get('odk-renderer-development-plugins')().length, 0)
})

test('child launcher isolates profiles and cleans them after completion, timeout, or spawn failure', () => {
  const profiles = []
  for (const result of [{ status: 0 }, { status: 1 }, { status: null, error: Error('timed out') }, null]) {
    let profile
    const spawn = (executable, args, options) => {
      assert.equal(executable, process.execPath)
      assert.equal(path.basename(args[0]), 'electron-fixture-runner.cjs')
      profile = args[1]
      profiles.push(profile)
      assert.equal(fs.existsSync(profile), true)
      assert.equal(args[2], path.join(__dirname, 'widget-density.cjs'))
      assert.equal(args[3], '--theme=pixel')
      assert.equal(options.timeout, 1234)
      fs.writeFileSync(path.join(profile, 'owned-state'), 'fixture')
      if (result === null) throw Error('spawn failed')
      return result
    }
    const run = () => runFixture('widget-density.cjs', ['--theme=pixel'], { timeout: 1234, spawn })
    if (result === null) assert.throws(run, /spawn failed/)
    else assert.equal(run(), result)
    assert.equal(fs.existsSync(profile), false)
  }
  assert.equal(new Set(profiles).size, profiles.length)
})

for (const outcome of [
  { status: 0, signal: null, error: Object.assign(Error('child deadline elapsed'), { code: 'ETIMEDOUT' }) },
  { status: 0, signal: 'SIGTERM' },
  { status: null, signal: 'SIGKILL' },
  { status: null, error: Object.assign(Error('spawn failed'), { code: 'ENOENT' }) },
]) test(`child failure reaches the E2E result despite status ${outcome.status}: ${outcome.error?.code || outcome.signal}`, () => {
  let profile
  const result = runFixture('widget-density.cjs', [], { spawn(_executable, args) {
    profile = args[1]
    assert.equal(fs.existsSync(profile), true)
    return outcome
  } })
  assert.notEqual(result.status, 0)
  assert.equal(result.error, outcome.error)
  assert.equal(result.signal, outcome.signal)
  assert.equal(fs.existsSync(profile), false)
  const source = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8')
  const exitStatus = source.split('\n').find(line => line.trimStart().startsWith('process.exitCode = Object.entries(subStatuses)'))
  assert.ok(exitStatus)
  for (const subStatuses of [{ child: result.status }, { children: [0, result.status, 0] }]) {
    const context = { process: {}, subStatuses }
    vm.runInNewContext(exitStatus, context)
    assert.equal(context.process.exitCode, 1)
  }
})

test('child runner sets its profile and hides the dock before loading fixture code', () => {
  const calls = []
  const profile = path.join(__dirname, 'fixtures', 'temporary-profile')
  const fixture = path.join(__dirname, 'widget-density.cjs')
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'helpers/electron-fixture-runner.cjs'), 'utf8'), {
    process: { platform: 'darwin', argv: ['electron', 'runner', profile, fixture] },
    require(name) {
      if (name === 'electron') return { app: { dock: { hide() { calls.push('hide') } },
        setPath(key, value) { calls.push([key, value]) } } }
      if (name === 'node:path') return path
      assert.equal(name, fixture)
      calls.push('fixture')
    },
  })
  assert.deepEqual(calls, ['hide', ['userData', profile], ['sessionData', profile], 'fixture'])
})

function agentHomeWatchdog(platform, arch, args = []) {
  const source = fs.readFileSync(path.join(__dirname, 'agent-home.cjs'), 'utf8')
  const start = source.indexOf('const timeoutMs = ')
  const end = source.indexOf('async function capturePaintedFrame()', start)
  assert.ok(start > 0 && end > start)
  const errors = [], exits = []
  let callback, budget, cleared = false
  vm.runInNewContext(source.slice(start, end), {
    process: { platform, arch, argv: ['electron', 'agent-home.cjs', ...args] },
    setTimeout(fn, timeout) { callback = fn; budget = timeout; return 1 },
    clearTimeout(timer) { assert.equal(timer, 1); cleared = true },
    console: { error(message) { errors.push(message) } },
    app: { exit(code) { exits.push(code) } }, win: undefined, profile: 'owned-profile',
    fs: { rmSync() {} },
  })
  return { budget, expire() { callback(); return { errors, exits, cleared } } }
}

for (const [platform, arch] of [['linux', 'arm64'], ['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'arm64']]) {
  test(`Agent Home watchdog bounds the full matrix and short modes on ${platform} ${arch}`, () => {
    const source = fs.readFileSync(path.join(__dirname, 'agent-home.cjs'), 'utf8')
    const modes = [...new Set([...source.matchAll(/process\.argv\.includes\('([^']+)'\)/g)]
      .map(match => match[1]).filter(flag => flag.endsWith('-only')))]
    modes.push('--future-mode-only', '--adaptive-copy', '--session-reply-legacy-host')
    const full = agentHomeWatchdog(platform, arch)
    assert.equal(full.budget, platform === 'linux' && arch === 'arm64' ? 240000 : 60000)
    for (const flag of modes) assert.equal(agentHomeWatchdog(platform, arch, [flag]).budget, 60000, flag)
    const parent = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8')
    const start = parent.indexOf('  const themeUiRuns = ')
    const end = parent.indexOf('  const subStatuses = ', start)
    assert.ok(start > 0 && end > start)
    const requests = []
    vm.runInNewContext(parent.slice(start, end), {
      process: { platform, arch }, runFixture(file, args, options) { requests.push({ file, args, options }); return { status: 0 } },
    })
    const matrix = requests.find(request => request.file === 'agent-home.cjs')
    assert.equal(matrix.args.length, 0)
    assert.ok(matrix.options.timeout > full.budget, 'The matrix parent must outlive its fixture watchdog')
    let shortParentTimeout
    runFixture('agent-home.cjs', [modes[0]], { platform, spawn(_executable, _args, options) {
      shortParentTimeout = options.timeout
      return { status: 0 }
    } })
    assert.ok(modes.every(flag => agentHomeWatchdog(platform, arch, [flag]).budget < shortParentTimeout), 'Short modes must finish before the default parent deadline')
    const expired = full.expire()
    assert.deepEqual(expired.exits, [1])
    assert.equal(expired.cleared, true)
    assert.equal(expired.errors.length, 1)
    assert.match(expired.errors[0], new RegExp(`timed out after ${full.budget}ms on ${arch}`))
  })
}

test('Home fixture establishes its requested viewport and settles geometry after hidden loading', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'agent-home.cjs'), 'utf8')
  const start = source.indexOf('  await win.loadFile(')
  const end = source.indexOf('  assert.equal(await evaluate', start)
  assert.ok(start > 0 && end > start)
  const helperStart = source.indexOf('async function resize(')
  const helperEnd = source.indexOf('async function send(', helperStart)
  assert.ok(helperStart > 0 && helperEnd > helperStart)
  const calls = []
  let width, height
  const renderer = vm.createContext({
    innerWidth: 1, innerHeight: 1, devicePixelRatio: 1, __odkGrid: { width: 1, height: 1 },
    requestAnimationFrame(callback) { calls.push('frame'); queueMicrotask(() => callback(0)) },
    document: { fonts: { ready: Promise.resolve() } },
    Event: class { constructor(type) { this.type = type } },
  })
  renderer.window = { dispatchEvent(event) {
    assert.equal(event.type, 'resize')
    renderer.__odkGrid = { width: renderer.innerWidth, height: renderer.innerHeight }
    calls.push('resize')
  } }
  await vm.runInNewContext(`(async () => { ${source.slice(helperStart, helperEnd)} ${source.slice(start, end)} })()`, {
    __dirname, path, assert, setTimeout,
    win: {
      async loadFile() { renderer.innerWidth = renderer.innerHeight = 1; calls.push('load') },
      setContentSize(w, h) { width = w; height = h; calls.push('size') },
      webContents: {
        debugger: {
          attach(version) { assert.equal(version, '1.3'); calls.push('attach') },
          async sendCommand(command, metrics) {
            if (command === 'Page.enable') { calls.push('enable'); return }
            assert.equal(command, 'Emulation.setDeviceMetricsOverride')
            assert.equal(width, 1920); assert.equal(height, 1280)
            assert.equal(metrics.width, width); assert.equal(metrics.height, height)
            assert.equal(metrics.deviceScaleFactor, 1); assert.equal(metrics.mobile, false)
            renderer.innerWidth = width; renderer.innerHeight = height
            calls.push('metrics')
          },
        },
        setZoomFactor(value) { assert.equal(value, 1); calls.push('zoom') },
      },
    },
    async evaluate(script) {
      assert.equal(width, 1920); assert.equal(height, 1280)
      if (script.includes('innerWidth ===')) calls.push('settled')
      return vm.runInContext(script, renderer)
    },
  })
  assert.deepEqual(calls, ['load', 'attach', 'enable', 'zoom', 'size', 'metrics', 'resize', 'settled', 'resize', 'frame', 'frame'])
})

test('first MIC check waits for control receipt without replaying input', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'voice-input-ui.cjs'), 'utf8')
  const start = source.indexOf('    const before = toggleCount', source.indexOf('async function firstMic()'))
  const end = source.indexOf('    assert.equal(await evaluate', start)
  assert.ok(start > 0 && end > start)
  let inputs = 0
  const context = { assert, Date, state: 'idle', toggleCount: 0, toggleStatus: null,
    async mic() { inputs++ }, async pause() { context.toggleCount++ } }
  await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, context)
  assert.equal(inputs, 1)
  assert.equal(context.toggleCount, 1)
})

test('installed Widget geometry waits for the requested renderer viewport', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'user-app-desktop.cjs'), 'utf8')
  const start = source.indexOf('      win.setContentSize(width,')
  const end = source.indexOf('      const geometry', start)
  assert.ok(start > 0 && end > start)
  const calls = []
  await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
    width: 320,
    win: {
      setContentSize(w, h) { assert.equal(w, 320); assert.equal(h, 480); calls.push('size') },
      webContents: { debugger: { async sendCommand(name, metrics) {
        assert.equal(name, 'Emulation.setDeviceMetricsOverride')
        assert.equal(metrics.width, 320); assert.equal(metrics.height, 480)
        calls.push('metrics')
      } } },
    },
    async delay() { calls.push('delay') },
    async js(script) { assert.match(script, /resize/); calls.push('resize') },
    async wait(script) { assert.match(script, /window\.__odkGrid.*320/); calls.push('settled') },
  })
  assert.deepEqual(calls, ['size', 'metrics', 'resize', 'settled'])
})


for (const [name, file] of [['Calendar', 'calendar-surface-electron.cjs'], ['Desk tools', 'desk-tool-surface-electron.cjs'], ['Pi status', 'pi-status-surface-electron.cjs'], ['Dashboard', 'dashboard-surface-electron.cjs'], ['Installed desktop', 'user-app-desktop-plugins-electron.cjs'], ['Built-in views', 'builtin-view-replacement.cjs']])
  test(`${name} comparison establishes renderer metrics after hidden loading`, async () => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    const start = source.indexOf('  await win.loadFile(')
    const end = source.indexOf('  const js = ', start)
    assert.ok(start > 0 && end > start)
    const calls = []
    let width = 1280, height = 776, scale = 1.25
    await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      __dirname, path, checkpoint() {},
      win: {
        async loadFile() { calls.push('load') },
        setContentSize(w, h) { assert.equal(w, 1920); assert.equal(h, 1280); calls.push('size') },
        webContents: {
          debugger: { async sendCommand(name, metrics) {
            assert.equal(name, 'Emulation.setDeviceMetricsOverride')
            assert.equal(metrics.mobile, false)
            width = metrics.width; height = metrics.height; scale = metrics.deviceScaleFactor
            calls.push('metrics')
          } },
          setZoomFactor(value) { assert.equal(value, 1); calls.push('zoom') },
        },
      },
    })
    assert.deepEqual([width, height, scale], [1920, 1280, 1])
    assert.deepEqual(calls, ['load', 'size', 'metrics', 'zoom'])
  })


for (const [name, file] of [['Calendar', 'calendar-surface-electron.cjs'], ['Desk tools', 'desk-tool-surface-electron.cjs'], ['Pi status', 'pi-status-surface-electron.cjs'], ['Quota', 'quota-surface-electron.cjs'], ['Quota provider', 'quota-plugin-electron.cjs'], ['Input status', 'input-status-surface-electron.cjs'], ['Dashboard', 'dashboard-surface-electron.cjs'], ['Installed desktop', 'user-app-desktop-plugins-electron.cjs'], ['Built-in views', 'builtin-view-replacement.cjs'], ['Weather', 'weather-plugin-electron.cjs'], ['WeRead', 'weread-plugin-electron.cjs'], ['Pi Widget', 'pi-tile-surface-electron.cjs'], ['Pi App and Page', 'pi-plugin-electron.cjs'], ['Hydra', 'hydra-surface-electron.cjs']])
  test(`${name} comparisons render frames without showing a host window`, () => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    const start = source.indexOf('new BrowserWindow(')
    const end = source.indexOf("\n  win.webContents.setWindowOpenHandler", start)
    assert.ok(start > 0 && end > start)
    let options
    vm.runInNewContext(source.slice(start, end), {
      __dirname, path, checkpoint() {}, BrowserWindow: function(value) { options = value },
    })
    assert.equal(options.show, false)
    assert.equal(options.webPreferences.backgroundThrottling, false)
    assert.equal(options.webPreferences.offscreen, true)
  })

test('Quota consumer profile is independent of Electron command-line argument ordering', () => {
  const source = fs.readFileSync(path.join(__dirname, 'quota-plugin-electron.cjs'), 'utf8')
  const prefix = source.slice(0, source.indexOf("const { fixture, channel }"))
  const profile = path.join(require('node:os').tmpdir(), 'odk-quota-profile-contract')
  for (const argv of [['electron', 'fixture.cjs', profile], ['electron', '--user-data-dir=' + profile, 'fixture.cjs', profile]]) {
    const calls = []
    vm.runInNewContext(prefix, {
      process: { platform: 'linux', argv, env: { ODK_QUOTA_PLUGIN_PROFILE: profile } },
      require: name => name === 'electron'
        ? { app: { setPath: (key, value) => calls.push([key, value]) } }
        : require(name),
    })
    assert.deepEqual(calls, [['userData', profile], ['sessionData', profile]])
  }
  const launcher = fs.readFileSync(path.join(__dirname, 'quota-electron.test.js'), 'utf8')
  assert.match(launcher, /ODK_QUOTA_PLUGIN_PROFILE: profile/)
})

for (const size of [[960, 640], [320, 480]]) {
  test(`Quota comparison establishes renderer metrics at ${size.join('x')}`, async () => {
    const source = fs.readFileSync(path.join(__dirname, 'quota-surface-electron.cjs'), 'utf8')
    const start = source.indexOf('      win.setContentSize(...size)')
    const end = source.indexOf('      await js(`window.odkTheme.set(', start)
    assert.ok(start > 0 && end > start)
    let viewport = [1280, 776], scale = 1.25
    const calls = []
    await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      size,
      win: {
        setContentSize(...bounds) { assert.deepEqual(bounds, size); calls.push('size') },
        webContents: { debugger: { async sendCommand(name, metrics) {
          assert.equal(name, 'Emulation.setDeviceMetricsOverride')
          assert.equal(metrics.mobile, false)
          viewport = [metrics.width, metrics.height]; scale = metrics.deviceScaleFactor
          calls.push('metrics')
        } } },
      },
    })
    assert.deepEqual(viewport, size)
    assert.equal(scale, 1)
    assert.deepEqual(calls, ['size', 'metrics'])
  })
}

for (const size of [[320, 480], [960, 640], [1920, 1280]]) {
  test(`Input status comparison establishes renderer metrics at ${size.join('x')}`, async () => {
    const source = fs.readFileSync(path.join(__dirname, 'input-status-surface-electron.cjs'), 'utf8')
    const start = source.indexOf('      win.setContentSize(width,height)')
    const end = source.indexOf('      await js(`window.odkTheme.set(', start)
    assert.ok(start > 0 && end > start)
    let viewport = [1280, 776], scale = 1.25
    const calls = []
    await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
      width: size[0], height: size[1],
      win: {
        setContentSize(...bounds) { assert.deepEqual(bounds, size); calls.push('size') },
        webContents: { debugger: { async sendCommand(name, metrics) {
          assert.equal(name, 'Emulation.setDeviceMetricsOverride')
          assert.equal(metrics.mobile, false)
          viewport = [metrics.width, metrics.height]; scale = metrics.deviceScaleFactor
          calls.push('metrics')
        } } },
      },
    })
    assert.deepEqual(viewport, size)
    assert.equal(scale, 1)
    assert.deepEqual(calls, ['size', 'metrics'])
  })
}

for (const count of [1, 7]) {
  test(`built-in view key batch observes all ${count} native key releases`, async () => {
    const source = fs.readFileSync(path.join(__dirname, 'builtin-view-replacement.cjs'), 'utf8')
    const start = source.indexOf('  const key = async ')
    const end = source.indexOf('  const focusBaseline = ', start)
    const listeners = new Map(), events = [], calls = []
    const window = { addEventListener(name, callback, options) { listeners.set(name, { callback, options }) },
      removeEventListener(name, callback) { if (listeners.get(name)?.callback === callback) listeners.delete(name) } }
    const context = { window }
    await vm.runInNewContext(`(async()=>{${source.slice(start, end)};await key('Backspace', [], ${count})})()`, {
      keySequence: 0,
      async js(script) { calls.push('register'); return vm.runInNewContext(script, context) },
      async wait(expression) { calls.push('wait'); assert.equal(vm.runInNewContext(expression, context), true) },
      win: { webContents: { sendInputEvent(event) {
        events.push(event.type)
        if (event.type === 'keyUp') {
          const listener = listeners.get('keyup'); listener?.callback()
          if (listener?.options?.once) listeners.delete('keyup')
        }
      } } },
    })
    assert.equal(events.length, count * 2)
    assert.equal(window.viewKeySequence, count)
    assert.equal(listeners.size, 0)
    assert.deepEqual(calls, ['register', 'wait'])
  })
}

for (const [name, file] of [['Weather', 'weather-plugin-electron.cjs'], ['WeRead', 'weread-plugin-electron.cjs']]) {
  for (const size of [[1920, 1280], [1920, 1080], [960, 640], [480, 854], [320, 480]]) {
    test(`${name} hidden comparison restores renderer metrics after loading at ${size.join('x')}`, async () => {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
      const start = source.indexOf('      win.setContentSize(...size)')
      const end = source.indexOf('      if (surfaceReplacement)', start)
      assert.ok(start > 0 && end > start)
      let viewport = [1280, 776], scale = 1.25, zoom = 1.25
      const calls = []
      await vm.runInNewContext(`(async () => { ${source.slice(start, end)} })()`, {
        size, __dirname, path, assert,
        win: {
          setContentSize(...bounds) { assert.deepEqual(bounds, size); calls.push('size') },
          async loadFile() { viewport = [1280, 776]; scale = 1.25; calls.push('load') },
          webContents: {
            debugger: {
              attach(version) { assert.equal(version, '1.3'); calls.push('attach') },
              detach() { calls.push('detach') },
              async sendCommand(name, metrics) {
                assert.equal(name, 'Emulation.setDeviceMetricsOverride')
                assert.equal(metrics.mobile, false)
                viewport = [metrics.width, metrics.height]; scale = metrics.deviceScaleFactor
                calls.push('metrics')
              },
            },
            setZoomFactor(value) { zoom = value; calls.push('zoom') },
          },
        },
        async js(script) {
          if (script === 'window.odkShellReady') { calls.push('ready'); return }
          assert.equal(script, '[innerWidth, innerHeight, devicePixelRatio]')
          return [...viewport, scale]
        },
      })
      assert.deepEqual(viewport, size)
      assert.equal(scale, 1)
      assert.equal(zoom, 1)
      assert.deepEqual(calls, ['size', 'load', 'attach', 'metrics', 'detach', 'zoom', 'ready'])
    })
  }
}

for (const [name, file] of [['Weather layout', 'weather-layout.cjs'], ['Weather', 'weather-plugin-electron.cjs'], ['WeRead', 'weread-plugin-electron.cjs'], ['Pi Widget', 'pi-tile-surface-electron.cjs'], ['Pi App and Page', 'pi-plugin-electron.cjs'], ['Widget and App interiors', 'widget-app-styles.cjs'], ['Agent', 'agent-home.cjs'], ['Widget navigation', 'widget-navigation.cjs']]) {
  for (const platform of ['linux', 'win32', 'darwin']) {
    test(`${name} comparison selects software rendering only on ${platform}`, () => {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
      const statement = source.split('\n').find(line => line.includes('app.disableHardwareAcceleration()'))
      assert.ok(statement, 'Software rendering must be selected before readiness')
      assert.ok(source.indexOf(statement) < source.indexOf('app.whenReady()'))
      let calls = 0
      vm.runInNewContext(statement, { process: { platform }, app: { disableHardwareAcceleration() { calls++ } } })
      assert.equal(calls, platform === 'linux' ? 1 : 0)
    })
  }
}


for (const [name, externalViews, capturedViews, env, expected] of [
  ['default comparison', undefined, false, {}, [false, true]],
  ['captured comparison', undefined, true, {}, [false, true]],
  ['captured missing Page', undefined, true, { ODK_PI_CAPTURED_VIEWS_DEFAULT: '1' }, [true]],
  ['unused captured mutation', undefined, false, { ODK_PI_CAPTURED_VIEWS_DEFAULT: '1' }, [false, true]],
  ['development comparison', 'development', true, {}, [false, true]],
  ['native comparison', 'native', true, {}, [false, true]],
  ['development missing Page', 'development', true, { ODK_PI_EXTERNAL_MISSING_PAGE: '1' }, [true]],
  ['native missing Page', 'native', true, { ODK_PI_EXTERNAL_MISSING_PAGE: '1' }, [true]],
]) {
  test(`Pi view phase selection: ${name}`, () => {
    const fixture = fs.readFileSync(path.join(__dirname, 'pi-plugin-electron.cjs'), 'utf8')
    const start = fixture.indexOf('  const missingExternalPage = ')
    const end = fixture.indexOf('    phase = ', start)
    assert.ok(start >= 0 && end > start)
    const phases = []
    vm.runInNewContext(fixture.slice(start, end) + 'phases.push(signed) }', {
      externalViews, capturedViews, process: { env }, phases,
    })
    assert.deepEqual(phases, expected)
  })
}

for (const [platform, arch] of [['linux', 'arm64'], ['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']]) {
  test(`Pi view matrix retains bounded deadlines on ${platform} ${arch}`, () => {
    const { viewTimeouts } = require('./helpers/pi-view-selection')
    assert.equal(typeof viewTimeouts, 'function')
    const arm = platform === 'linux' && arch === 'arm64'
    assert.deepEqual(viewTimeouts(platform, arch), {
      fixture: arm ? 150000 : 45000, child: arm ? 160000 : 55000, test: arm ? 180000 : 60000,
      guardChild: arm ? 60000 : 12000, guardTest: arm ? 65000 : 15000,
      externalGuardChild: arm ? 60000 : 18000, externalGuardTest: arm ? 65000 : 20000,
    })
    const fixture = fs.readFileSync(path.join(__dirname, 'pi-plugin-electron.cjs'), 'utf8')
    assert.match(fixture, /}, viewTimeouts\(\)\.fixture\)/)
    assert.ok(fixture.includes('performance.now() + 4000'))
    const parent = fs.readFileSync(path.join(__dirname, 'pi-electron.test.js'), 'utf8')
    assert.equal((parent.match(/timeout: timeouts\.child/g) || []).length, 3)
    assert.equal((parent.match(/timeout: timeouts\.test/g) || []).length, 3)
    assert.equal((parent.match(/timeout: timeouts\.guardChild/g) || []).length, 2)
    assert.equal((parent.match(/timeout: timeouts\.guardTest/g) || []).length, 2)
    assert.ok(parent.includes('timeout: timeouts.externalGuardChild'))
    assert.ok(parent.includes('timeout: timeouts.externalGuardTest'))
  })
}

for (const [platform, arch] of [['linux', 'arm64'], ['linux', 'x64'], ['darwin', 'arm64'], ['win32', 'x64']]) {
  test(`Appearance Main comparison retains bounded deadlines on ${platform} ${arch}`, () => {
    const fixture = fs.readFileSync(path.join(__dirname, 'appearance-main-bootstrap.cjs'), 'utf8')
    const parent = fs.readFileSync(path.join(__dirname, 'appearance-main-bootstrap.test.js'), 'utf8')
    const read = (source, name) => {
      const statement = source.split('\n').find(line => line.startsWith(`const ${name} = `))
      assert.ok(statement, `Missing ${name}`)
      return vm.runInNewContext(`${statement}; ${name}`, { process: { platform, arch } })
    }
    const arm = platform === 'linux' && arch === 'arm64'
    assert.equal(read(fixture, 'appearanceFixtureTimeout'), arm ? 90000 : 45000)
    assert.equal(read(parent, 'appearanceChildTimeout'), arm ? 100000 : 55000)
    assert.equal(read(parent, 'appearanceTestTimeout'), arm ? 110000 : 65000)
    assert.match(fixture, /}, appearanceFixtureTimeout\)/)
    assert.ok(parent.includes('timeout: appearanceTestTimeout'))
    assert.ok(parent.includes('timeout: appearanceChildTimeout'))
    assert.ok(fixture.includes('performance.now() + 8000'))
    assert.ok(fixture.includes('performance.now() + 4000'))
    assert.ok(fixture.includes('timeout: 10000'))
    assert.ok(fixture.includes('createVerifier(options)'))
  })
}


for (const fixture of ['clock-main-bootstrap.cjs', 'dashboard-main-bootstrap.cjs', 'appearance-main-bootstrap.cjs']) test(`${fixture} hidden comparison preserves production preferences with an offscreen render target`, () => {
  const source = fs.readFileSync(path.join(__dirname, fixture), 'utf8')
  const start = source.indexOf('// Preserve production Main while giving its single hidden test window an offscreen render target.')
  assert.ok(start >= 0, 'Main hidden window needs its own render target')
  const preferences = { preload: '/controlled/preload.js', sandbox: true, contextIsolation: true }
  const options = { width: 1920, height: 1280, webPreferences: preferences }
  let actual, selected, constructed
  const windows = []
  class NativeWindow {
    constructor(value) { actual = value; windows.push(this) }
    static getAllWindows() { return windows.filter(win => win.constructor === NativeWindow) }
  }
  const original = () => { throw Error('Unexpected module load') }
  const loader = { _load: original }
  const electron = { BrowserWindow: NativeWindow, retainedExport: {} }
  const fakeRequire = name => {
    if (name === 'node:module') return loader
    if (name === 'electron') return electron
    assert.equal(name, '../src/main')
    selected = loader._load('electron', { filename: '/controlled/main.js' })
    constructed = new selected.BrowserWindow(options)
  }
  fakeRequire.resolve = name => { assert.equal(name, '../src/main'); return '/controlled/main.js' }
  vm.runInNewContext(source.slice(start), { require: fakeRequire, BrowserWindow: NativeWindow })
  assert.equal(actual.width, options.width)
  assert.equal(actual.height, options.height)
  assert.equal(actual.webPreferences.offscreen, true)
  for (const [key, value] of Object.entries(preferences)) assert.equal(actual.webPreferences[key], value)
  assert.equal(selected.retainedExport, electron.retainedExport)
  assert.equal(loader._load, original)
  assert.equal(options.webPreferences, preferences)
  assert.equal(preferences.offscreen, undefined)
  if (fixture === 'appearance-main-bootstrap.cjs') {
    assert.equal(constructed.constructor, NativeWindow)
    assert.deepEqual(selected.BrowserWindow.getAllWindows(), [constructed])
  }
})


test('composition startup rejection exits unsuccessfully with its diagnostic', async () => {
  const source = fs.readFileSync(path.join(__dirname, 'e2e.js'), 'utf8')
  const entry = source.slice(source.lastIndexOf('app.whenReady().then(main)'))
  const failure = Object.assign(Error('transient fixture directory cleanup failed'), { code: 'ENOTEMPTY' })
  const exits = [], errors = []
  await vm.runInNewContext(entry, {
    app: { whenReady: () => Promise.resolve(), exit: code => exits.push(code) },
    main: async () => { throw failure },
    console: { error: (...args) => errors.push(args) },
  })
  assert.deepEqual(exits, [1])
  assert.equal(errors.some(args => args.includes(failure)), true)
})

function runNavigationCli(results, argv = []) {
  const source = fs.readFileSync(path.join(__dirname, 'widget-navigation.cjs'), 'utf8')
  const requests = [], exits = [], logs = []
  const localRequire = createRequire(path.join(__dirname, 'widget-navigation.cjs'))
  const app = { exit(code) { exits.push(code) } }
  const load = name => {
    if (name === 'electron') return { app }
    if (name === './helpers/electron-fixture') return { runFixture(file, args, options) { requests.push({ file, args, options }); return results[requests.length - 1] } }
    if (name === 'node:fs') return { mkdtempSync() { throw Error('default navigation must orchestrate before profile access') } }
    return localRequire(name)
  }
  vm.runInNewContext('(function(require,process,console){' + source + '\n})', {}, { filename: 'widget-navigation.cjs' })(load, { argv: ['electron', 'widget-navigation.cjs', ...argv], platform: 'linux' }, { log(...args) { logs.push(args.join(' ')) }, error() {} })
  return { requests, exits, logs }
}

test('default navigation runs both complete phases and retains every phase result', () => {
  const actual = runNavigationCli([{ status: 0 }, { status: 0 }])
  assert.deepEqual(actual.requests.map(request => [request.file, ...request.args]), [
    ['widget-navigation.cjs', '--navigation-phase=continuations'],
    ['widget-navigation.cjs', '--navigation-phase=responsive'],
  ])
  assert.ok(actual.requests.every(request => request.options.timeout === 65000))
  assert.deepEqual(actual.exits, [0])
  assert.ok(actual.logs.some(line => line === 'WIDGET_NAVIGATION_PHASE_STATUS: [0,0]'))
})

test('navigation aggregate rejects child errors, signals, and incomplete exits', () => {
  for (const rejected of [{ status: 1 }, { status: null }, { status: 0, signal: 'SIGTERM' }, { status: 0, error: Error('ETIMEDOUT') }]) {
    const actual = runNavigationCli([rejected, { status: 0 }])
    assert.equal(actual.requests.length, 2, 'a failed first phase does not omit later coverage')
    assert.deepEqual(actual.exits, [1])
  }
})

test('unknown navigation phases fail before profile access', () => {
  assert.throws(() => runNavigationCli([], ['--navigation-phase=typo']), /Unknown navigation phase/)
})

async function runOpaqueTouch(targets) {
  const source = fs.readFileSync(path.join(__dirname, 'user-app-desktop.cjs'), 'utf8')
  const start = source.indexOf('  const { targetInfos }')
  const end = source.indexOf("  await clickDot('installed:counter')", start)
  assert.ok(start > 0 && end > start, 'native input must bind its owned frame before dispatch')
  const calls = []
  const url = 'odk-user-app://app/counter/r1?token=fixture'
  const debuggerApi = { async sendCommand(method, parameters, session) {
    calls.push({ method, parameters, session })
    if (method === 'Target.getTargets') return { targetInfos: targets ?? [{ type: 'iframe', targetId: 'other', url: 'about:blank' }, { type: 'iframe', targetId: 'owned', url }] }
    if (method === 'Target.attachToTarget') return { sessionId: 'owned-session' }
    return {}
  } }
  await vm.runInNewContext('(async()=>{' + source.slice(start, end) + 'await touchApp()})()', {
    win: { webContents: { debugger: debuggerApi } },
    appFrame: { url, async executeJavaScript() { return { x: 550, y: 500 } } },
    assert, delay: async () => {}, js() { throw Error('iframe input must not use parent viewport coordinates') },
  })
  return calls
}

test('opaque native touch binds the owned iframe session and local viewport', async () => {
  const calls = await runOpaqueTouch()
  assert.equal(calls.find(call => call.method === 'Target.attachToTarget').parameters.targetId, 'owned')
  const touches = calls.filter(call => call.method === 'Input.dispatchTouchEvent')
  assert.deepEqual(touches.map(call => call.parameters.type), ['touchStart', 'touchMove', 'touchEnd'])
  assert.ok(touches.every(call => call.session === 'owned-session'))
  assert.equal(touches[0].parameters.touchPoints[0].x, 430)
  assert.equal(touches[0].parameters.touchPoints[1].x, 670)
  assert.equal(touches[1].parameters.touchPoints[0].x, 490)
})

test('ambiguous or missing opaque frame targets reject before touch input', async () => {
  const owned = { type: 'iframe', targetId: 'first', url: 'odk-user-app://app/counter/r1?token=fixture' }
  for (const targets of [[], [owned, { ...owned, targetId: 'second' }]]) {
    await assert.rejects(runOpaqueTouch(targets), /one actual counter iframe target/)
  }
})

function adviceEndWait() {
  const source = fs.readFileSync(path.join(__dirname, 'proactive-panel.cjs'), 'utf8')
  const start = source.indexOf('async function waitForAdviceEnd(')
  const end = source.indexOf('app.whenReady().then(async () => {', start)
  assert.ok(start >= 0 && end > start, 'long advice waits on observed native key and scroll state')
  return vm.runInNewContext(source.slice(start, end) + '\nwaitForAdviceEnd', { performance, setTimeout, assert })
}

test('native End readiness does not mistake an intermediate scroll frame for the end', async () => {
  let calls = 0
  await adviceEndWait()(async () => ({ focused: true, atEnd: ++calls > 1 }), 200)
  assert.equal(calls, 2)
})

test('native End readiness rejects lost focus or an unfinished scroll', async () => {
  for (const incomplete of [{ focused: false, atEnd: true }, { focused: true, atEnd: false }]) {
    await assert.rejects(adviceEndWait()(async () => incomplete, 0), /Native End did not reach/)
  }
})
