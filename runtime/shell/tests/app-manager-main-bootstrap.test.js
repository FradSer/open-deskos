'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { selection } = require('./helpers/app-manager')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
const { posixOnlyReason } = require('./not-ported')
const electron = require('electron')

test('production Main preserves default, independent signed and development navigation, and corrupt selection recovery',
  { timeout: 150000, skip: posixOnlyReason('isolated-native-activation') }, async t => {
    const fixture = path.join(__dirname, 'app-manager-main-bootstrap.cjs')
    await fs.access(fixture)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-app-manager-production-'))
    const pids = new Set()
    let baseline
    try {
      for (const mode of ['default', 'signed', 'development', 'corrupt']) {
        const directory = path.join(root, mode)
        await fs.mkdir(directory)
        let env = { ...process.env, ODK_CONFIG_DIR: path.join(directory, 'config'),
          XDG_STATE_HOME: path.join(directory, 'state'), LOCALAPPDATA: path.join(directory, 'state') }
        if (mode !== 'default') {
          const selected = await selection(t, { mode: mode === 'development' ? mode : 'signed', parentDir: directory })
          env = selected.env
          if (mode === 'corrupt') await fs.appendFile(path.join(selected.stored.root, 'manager.js'), '\nthrow Error("Controlled Main selection corruption")')
        }
        const expectedVersion = ['default', 'corrupt'].includes(mode) ? '1.0.0' : '2.0.0'
        const enabled = new Set(['odk.system.app-manager', 'odk.system.renderer-development'])
        env = { ...env, ODK_APP_MANAGER_MAIN_PROFILE: path.join(directory, 'profile'), ODK_APP_MANAGER_MAIN_VERSION: expectedVersion,
          ODK_WORKSPACE: path.join(directory, 'workspace'), ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280',
          ODK_DISABLE_GPU: '1', ODK_DISABLED_PLUGINS: createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',') }
        delete env.ELECTRON_RUN_AS_NODE
        delete env.XDG_RUNTIME_DIR
        const result = await runCommand(electron, [`--user-data-dir=${env.ODK_APP_MANAGER_MAIN_PROFILE}`, fixture],
          { env, signal: t.signal, timeout: 35000, maxBuffer: 1024 * 1024 })
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.productionMain, true)
        assert.equal(report.actualPreload, true)
        assert.equal(report.version, expectedVersion)
        assert.equal(report.defaultConstructions, expectedVersion === '1.0.0' ? 1 : 0)
        assert.equal(report.hidden, true)
        assert.equal(report.handlersReleased, true)
        assert.equal(pids.has(report.pid), false)
        pids.add(report.pid)
        if (mode === 'corrupt') assert.match(result.stderr, /native plugin unavailable: odk.system.app-manager/)
        if (baseline) assert.deepEqual(report.consumer, baseline)
        else baseline = report.consumer
      }
      assert.equal(pids.size, 4)
    } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})


for (const { rejected, fullComposition } of [
  { rejected: false, fullComposition: false }, { rejected: true, fullComposition: false },
  { rejected: false, fullComposition: true }, { rejected: true, fullComposition: true },
]) {
  test(`authenticated ${fullComposition ? 'fully enabled' : 'isolated'} Main manager ${rejected ? 'recovers rejected state restoration' : 'activation and recovery preserve the mounted foreground'}`,
    { timeout: 45000, skip: posixOnlyReason('isolated-native-activation') }, async t => {
      const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-app-manager-live-'))
      try {
        const selected = await selection(t, { parentDir: root, ...(rejected ? { transformManager: source => {
          const marker = 'const restoreState = snapshot => {'
          assert.ok(source.includes(marker))
          return source.replace(marker, marker + "\n    throw Error('Controlled state restoration rejection')")
        } } : {}) })
        const enabled = new Set(['odk.system.app-manager', 'odk.system.renderer-development', 'odk.system.plugin-control'])
        const env = { ...selected.env, ODK_APP_MANAGER_MAIN_PROFILE: path.join(root, 'profile'), ODK_APP_MANAGER_MAIN_VERSION: '1.0.0',
          ODK_APP_MANAGER_MAIN_LIVE: '1', ODK_APP_MANAGER_MAIN_REJECT: rejected ? '1' : '0', XDG_RUNTIME_DIR: path.join(root, 'runtime'),
          ODK_APP_MANAGER_MAIN_COMPOSITION: fullComposition ? '1' : '0',
          ODK_WORKSPACE: path.join(root, 'workspace'), ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280',
          ODK_DISABLE_GPU: '1', ODK_DISABLED_PLUGINS: fullComposition ? '' : createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',') }
        delete env.ELECTRON_RUN_AS_NODE
        await fs.mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })
        const result = await runCommand(electron, [`--user-data-dir=${env.ODK_APP_MANAGER_MAIN_PROFILE}`, path.join(__dirname, 'app-manager-main-bootstrap.cjs')],
          { env, signal: t.signal, timeout: 35000, maxBuffer: 1024 * 1024 })
        const report = JSON.parse(result.stdout.trim().split('\n').pop())
        assert.equal(report.productionMain, true)
        assert.equal(report.actualPreload, true)
        assert.equal(report.runtimeHandoff, true)
        assert.equal(report.rejected, rejected)
        assert.equal(report.defaultConstructions, 2)
        assert.equal(report.handlersReleased, true)
        if (fullComposition) {
          assert.equal(report.fullComposition, true)
          assert.equal(report.mainPlugins, createMainPlugins().length)
        }
        const { resolveShellHost } = require('../src/platform')
        const host = resolveShellHost({ env })
        const channels = fullComposition
          ? ['plugin-control', 'renderer-plugin-control', 'plugin-diagnostics', 'user-app-control', 'odk-data'] : ['plugin-control']
        for (const channel of channels) await assert.rejects(fs.stat(host.endpoint(channel)), { code: 'ENOENT' })
      } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
    })
}

test('production Main preserves selected installed desktop consumers and detects a missing entry',
  { timeout: 90000, skip: posixOnlyReason('isolated-native-activation') }, async t => {
    const { createUserAppStore } = require('../src/user-app-store')
    const { resolveUserAppSurface } = require('../src/user-app-system')
    const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-desktop-main-'))
    try {
      for (const mode of ['default', 'development', 'missing']) {
        const directory = path.join(root, mode)
        const version = mode === 'default' ? '1.0.0' : '2.0.0'
        const env = { ...process.env, ODK_CONFIG_DIR: path.join(directory, 'config'),
          XDG_STATE_HOME: path.join(directory, 'state'), LOCALAPPDATA: path.join(directory, 'state'), XDG_RUNTIME_DIR: path.join(directory, 'runtime'),
          ODK_APP_MANAGER_MAIN_PROFILE: path.join(directory, 'profile'), ODK_APP_MANAGER_MAIN_VERSION: '1.0.0',
          ODK_APP_MANAGER_MAIN_LIVE: '0', ODK_APP_MANAGER_MAIN_REJECT: '0', ODK_APP_MANAGER_MAIN_COMPOSITION: '1',
          ODK_BUILTIN_MAIN_VERSION: '', ODK_DIAGNOSTIC_MAIN_MODE: '', ODK_INSTALLED_DESKTOP_MAIN_VERSION: version,
          ODK_WORKSPACE: path.join(directory, 'workspace'), ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280',
          ODK_DISABLE_GPU: '1', ODK_DISABLED_PLUGINS: '' }
        delete env.ELECTRON_RUN_AS_NODE
        await fs.mkdir(env.XDG_RUNTIME_DIR, { recursive: true, mode: 0o700 })
        const store = createUserAppStore({ workspace: env.ODK_WORKSPACE, stateDir: resolveUserAppSurface({ env }).stateDir, verify: () => true })
        // Seed private accepted snapshots. This check exercises startup, not installation verification.
        for (const [id, kind] of [['note', 'widget'], ['counter', 'app']]) {
          const draft = path.join(env.ODK_WORKSPACE, 'apps', id)
          await fs.mkdir(draft, { recursive: true })
          await fs.writeFile(path.join(draft, 'manifest.json'), JSON.stringify({ schemaVersion: 1, id, name: id, version: '1', kind }))
          await fs.writeFile(path.join(draft, 'index.html'), kind === 'app'
            ? '<button id="counter">0</button><script>counter.onclick=()=>counter.textContent=Number(counter.textContent)+1</script>'
            : '<p>Installed note</p>')
          assert.equal((await store.install(id, kind === 'widget' ? { pageId: 'desk', col: '2', row: '3' } : undefined)).ok, true)
        }
        if (mode === 'development') {
          const bundle = path.join(directory, 'desktop')
          await fs.cp(path.join(__dirname, 'fixtures/user-app-desktop-replacement'), bundle, { recursive: true })
          const entry = path.join(bundle, 'entry.js')
          await fs.writeFile(entry, 'window.desktopExternalEntryExecuted=true;\n' + await fs.readFile(entry, 'utf8'))
          await runCommand(process.execPath, [path.join(__dirname, '../scripts/odk-plugin-cli.js'), 'link', bundle, '--trust', '--replace'],
            { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal: t.signal, timeout: 10000 })
        }
        const running = runCommand(electron, [`--user-data-dir=${env.ODK_APP_MANAGER_MAIN_PROFILE}`, path.join(__dirname, 'app-manager-main-bootstrap.cjs')],
          { env, signal: t.signal, timeout: 35000, maxBuffer: 1024 * 1024 })
        if (mode === 'missing') await assert.rejects(running, /Production desktop entry execution missing/)
        else {
          const report = JSON.parse((await running).stdout.trim().split('\n').pop())
          assert.equal(report.productionMain, true)
          assert.equal(report.actualPreload, true)
          assert.equal(report.mainPlugins, createMainPlugins().length)
          assert.equal(report.handlersReleased, true)
          assert.deepEqual(report.installedDesktop, { version, realCatalog: true, retainedAppState: true, foregroundPreserved: true, packageCommands: 2 })
        }
      }
    } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })

test('production Main preserves signed built-in App consumers and detects invalid entries',
  { timeout: 90000, skip: posixOnlyReason('isolated-native-activation') }, async t => {
    const { installBuiltinViews } = require('./helpers/builtin-view-selection')
    const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-builtin-main-'))
    let baseline
    try {
      for (const mode of ['default', 'signed', 'incorrect', 'missing']) {
        const directory = path.join(root, mode)
        await fs.mkdir(directory)
        const version = mode === 'default' ? '1.0.0' : '2.0.0'
        const env = { ...process.env, ODK_CONFIG_DIR: path.join(directory, 'config'),
          XDG_STATE_HOME: path.join(directory, 'state'), LOCALAPPDATA: path.join(directory, 'state'), XDG_RUNTIME_DIR: path.join(directory, 'runtime'),
          ODK_APP_MANAGER_MAIN_PROFILE: path.join(directory, 'profile'), ODK_APP_MANAGER_MAIN_VERSION: '1.0.0',
          ODK_APP_MANAGER_MAIN_LIVE: '0', ODK_APP_MANAGER_MAIN_REJECT: '0', ODK_APP_MANAGER_MAIN_COMPOSITION: '1',
          ODK_BUILTIN_MAIN_VERSION: version, ODK_WORKSPACE: path.join(directory, 'workspace'),
          ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280', ODK_DISABLE_GPU: '1', ODK_DISABLED_PLUGINS: '' }
        delete env.ELECTRON_RUN_AS_NODE
        await fs.mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })
        if (mode !== 'default') await installBuiltinViews(directory, env, {
          invalid: mode === 'incorrect', omitApp: mode === 'missing' ? 'clock' : undefined, signal: t.signal,
        })
        const running = runCommand(electron, [`--user-data-dir=${env.ODK_APP_MANAGER_MAIN_PROFILE}`, path.join(__dirname, 'app-manager-main-bootstrap.cjs')],
          { env, signal: t.signal, timeout: 35000, maxBuffer: 1024 * 1024 })
        if (mode === 'incorrect') await assert.rejects(running, /Production built-in Clock reading changed/)
        else if (mode === 'missing') await assert.rejects(running, /Production built-in fallback guard triggered/)
        else {
          const report = JSON.parse((await running).stdout.trim().split('\n').pop())
          assert.equal(report.productionMain, true)
          assert.equal(report.fullComposition, true)
          assert.equal(report.mainPlugins, createMainPlugins().length)
          assert.equal(report.handlersReleased, true)
          assert.equal(report.protocolReleased, true)
          assert.equal(report.builtinViews.version, version)
          assert.equal(report.builtinViews.phases, mode === 'default' ? 1 : 3)
          assert.equal(report.builtinViews.transitions, mode === 'default' ? 0 : 10)
          if (baseline) assert.deepEqual(report.builtinViews.startup, baseline)
          else baseline = report.builtinViews.startup
        }
      }
    } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })

test('production Main preserves externally selected diagnostic consumers and refuses missing replacements',
  { timeout: 60000, skip: posixOnlyReason('isolated-native-activation') }, async t => {
    const mainDiagnosis = require('./fixtures/main-diagnostics-replacement').independentMainDiagnostics
    const { independentCoordinator } = require('./fixtures/service-coordinator-replacements')
    const defaults = createMainPlugins()
    const declaredPorts = defaults.find(plugin => plugin.manifest.id === 'odk.system.plugin-diagnostics').manifest.requires.map(port => port.interface)
    const diagnosisOptions = { healthPorts: declaredPorts.filter(port => port.startsWith('odk:plugin-health/')),
      runtimePorts: declaredPorts.filter(port => port.startsWith('odk:plugin-runtime/')) }
    const factories = [
      require('./fixtures/channel-diagnostic-replacements').independentResidentDiagnosis,
      require('./fixtures/channel-diagnostic-replacements').independentRemoteDiagnosis,
      require('./fixtures/hosted-pi-diagnostic-replacement').independentHostedPiDiagnosis,
      require('./fixtures/futu-diagnostic-replacement').independentFutuDiagnosis,
      require('./fixtures/plugin-control-replacement').independentPluginControl,
      require('./fixtures/renderer-diagnostics-replacement').independentRendererDiagnostics,
      require('./fixtures/renderer-development-replacement').independentRendererDevelopment,
      require('./fixtures/renderer-control-replacement').independentRendererControl,
      mainDiagnosis,
    ].map(factory => ({ factory, options: factory === mainDiagnosis ? diagnosisOptions : {} }))
    for (const id of ['odk.system.service-refresh', 'odk.system.service-notifications', 'odk.system.frame-status']) {
      factories.push({ factory: independentCoordinator, options: { manifest: defaults.find(plugin => plugin.manifest.id === id).manifest } })
    }
    const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-diag-main-'))
    let baseline
    try {
      for (const mode of ['default', 'development', 'missing', 'missing-management', 'missing-renderer', 'missing-discovery', 'missing-control', 'missing-main-diagnosis',
        'missing-refresh', 'missing-notifications', 'missing-frame-status']) {
        const directory = path.join(root, mode)
        await fs.mkdir(directory)
        const env = { ...process.env, ODK_CONFIG_DIR: path.join(directory, 'config'),
          XDG_STATE_HOME: path.join(directory, 'state'), LOCALAPPDATA: path.join(directory, 'state'), XDG_RUNTIME_DIR: path.join(directory, 'runtime'),
          ODK_APP_MANAGER_MAIN_PROFILE: path.join(directory, 'profile'), ODK_APP_MANAGER_MAIN_VERSION: '1.0.0',
          ODK_APP_MANAGER_MAIN_LIVE: '0', ODK_APP_MANAGER_MAIN_REJECT: '0', ODK_APP_MANAGER_MAIN_COMPOSITION: '1',
          ODK_DIAGNOSTIC_MAIN_MODE: mode, ODK_BUILTIN_MAIN_VERSION: '', ODK_WORKSPACE: path.join(directory, 'workspace'),
          ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280', ODK_DISABLE_GPU: '1', ODK_DISABLED_PLUGINS: '' }
        delete env.ELECTRON_RUN_AS_NODE
        await fs.mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })
        if (mode !== 'default') for (const { factory, options } of factories) {
          const plugin = factory(options)
          if ((mode === 'missing' && plugin.manifest.id === 'odk.system.futu-runtime-diagnostics')
            || (mode === 'missing-management' && plugin.manifest.id === 'odk.system.plugin-control')
            || (mode === 'missing-renderer' && plugin.manifest.id === 'odk.system.renderer-diagnostics')
            || (mode === 'missing-discovery' && plugin.manifest.id === 'odk.system.renderer-development')
            || (mode === 'missing-control' && plugin.manifest.id === 'odk.system.renderer-control')
            || (mode === 'missing-main-diagnosis' && plugin.manifest.id === 'odk.system.plugin-diagnostics')
            || (mode === 'missing-refresh' && plugin.manifest.id === 'odk.system.service-refresh')
            || (mode === 'missing-notifications' && plugin.manifest.id === 'odk.system.service-notifications')
            || (mode === 'missing-frame-status' && plugin.manifest.id === 'odk.system.frame-status')) continue
          const folder = path.join(directory, plugin.manifest.id)
          await fs.mkdir(folder)
          await fs.writeFile(path.join(folder, 'manifest.json'), JSON.stringify({ ...plugin.manifest, entry: 'entry.cjs' }))
          const create = factory === independentCoordinator
            ? `require(${JSON.stringify(path.resolve(__dirname, 'fixtures/service-coordinator-replacements'))}).independentCoordinator(${JSON.stringify(options)}).create`
            : `(${factory.toString()})(${JSON.stringify(options)}).create`
          const shared = `const net=require('node:net');
const {randomUUID}=require('node:crypto');
const {NATIVE_PLUGIN_SCHEME}=require(${JSON.stringify(path.resolve(__dirname, '../src/native-renderer-assets'))});
const {RENDERER_DEVELOPMENT_CHANNEL}=require(${JSON.stringify(path.resolve(__dirname, '../src/plugins/renderer-development'))});
const port='odk:plugin-runtime/electron-renderer/v1';
const {sanitizeRuntimePlugins}=require(${JSON.stringify(path.resolve(__dirname, '../src/plugin-runtime-report'))});
const {healthPort}=require(${JSON.stringify(path.resolve(__dirname, '../src/plugins/health'))});
const {createPluginControl}=require(${JSON.stringify(path.resolve(__dirname, '../src/plugin-control'))});
const {createRendererManagement}=require(${JSON.stringify(path.resolve(__dirname, '../src/renderer-management'))});
const {listenOdkData}=require(${JSON.stringify(path.resolve(__dirname, '../src/odk-data-control'))});
const {SYSTEM_PORTS}=require(${JSON.stringify(path.resolve(__dirname, '../src/plugins/system-channels'))});
const {DESK_PORTS}=require(${JSON.stringify(path.resolve(__dirname, '../src/plugins/desk-runtime'))});
const {createRuntimeChannelProbe}=require(${JSON.stringify(path.resolve(__dirname, '../src/runtime-channel-probe'))});
exports.create=${create};
globalThis.odkDiagnosticMainEntries ||= [];
globalThis.odkDiagnosticMainEntries.push(${JSON.stringify(plugin.manifest.id)});`
          await fs.writeFile(path.join(folder, 'entry.cjs'), shared)
          await runCommand(process.execPath, [path.resolve(__dirname, '../scripts/odk-plugin-cli.js'), 'link', folder, '--trust', '--replace',
            ...plugin.manifest.permissions.flatMap(permission => ['--grant', permission])], { env, signal: t.signal, timeout: 10000 })
        }
        const running = runCommand(electron, [`--user-data-dir=${env.ODK_APP_MANAGER_MAIN_PROFILE}`, path.join(__dirname, 'app-manager-main-bootstrap.cjs')],
          { env, signal: t.signal, timeout: 35000, maxBuffer: 1024 * 1024 })
        if (mode.startsWith('missing')) await assert.rejects(running, /Production diagnostic fallback guard triggered/)
        else {
          const report = JSON.parse((await running).stdout.trim().split('\n').pop())
          assert.equal(report.productionMain, true)
          assert.equal(report.fullComposition, true)
          assert.equal(report.mainPlugins, createMainPlugins().length)
          assert.equal(report.handlersReleased, true)
          assert.equal(report.diagnostics.version, mode === 'default' ? '1.0.0' : '2.0.0')
          assert.equal(report.diagnostics.entries, mode === 'default' ? 0 : factories.length)
          assert.deepEqual(report.diagnostics.discoveryEntries, [])
          assert.equal(report.diagnostics.managementCommands, 2)
          assert.equal(report.diagnostics.rendererCommands, 2)
          assert.equal(report.diagnostics.notificationResult, false)
          assert.equal(report.diagnostics.listenersReleased, true)
          assert.equal(report.diagnostics.navigationRechecked, true)
          assert.equal(report.diagnostics.mainStates.length, report.mainPlugins)
          const consumers = { runtimes: report.diagnostics.runtimes, mainStates: report.diagnostics.mainStates,
            navigation: report.consumer, discoveryEntries: report.diagnostics.discoveryEntries }
          if (baseline) assert.deepEqual(consumers, baseline)
          else baseline = consumers
          const { resolveShellHost } = require('../src/platform')
          await assert.rejects(fs.stat(resolveShellHost({ env }).endpoint('plugin-diagnostics')), { code: 'ENOENT' })
          await assert.rejects(fs.stat(resolveShellHost({ env }).endpoint('plugin-control')), { code: 'ENOENT' })
          await assert.rejects(fs.stat(resolveShellHost({ env }).endpoint('renderer-plugin-control')), { code: 'ENOENT' })
        }
      }
    } finally { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
  })
