'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { createAppearancePlugin, createAppearancePlugins, createAppearanceHost, selectAppearanceFactories } = require('../src/renderer/core/appearance-plugins')
const { buildContextStyle, contextTokens } = require('../src/user-app-context')

function customPlugin() {
  return createAppearancePlugin({
    theme: 'fixture', name: 'Fixture appearance', css: 'themes/fixture.css',
    tokens: { '--odk-primary': '#fafafa' }, faces: ['zpix'],
  })
}

test('appearance declarations use the common host and preserve packaged identities', async () => {
  const runtime = createAppearanceHost()
  await runtime.start()
  assert.deepEqual(runtime.list().map(entry => entry.manifest.id), ['odk.theme.instrument', 'odk.theme.pixel', 'odk.theme.border-beam', 'odk.theme.liquid-glass'])
  assert.ok(runtime.list().every(entry => entry.state === 'running'))
  assert.equal(runtime.resolve('pixel').theme, 'pixel')
  assert.equal(runtime.resolve('unknown').theme, 'instrument')
  assert.equal(runtime.resolve('pixel').tokens['--odk-font'], '"Zpix", monospace')
  await runtime.stop()
})

test('a local appearance replacement needs no theme-specific consumer branch', async () => {
  const plugins = [...createAppearancePlugins(), customPlugin()]
  const runtime = createAppearanceHost({ plugins })
  await runtime.start()
  assert.equal(runtime.resolve('fixture').tokens['--odk-primary'], '#fafafa')
  assert.equal(runtime.resolve('fixture').css, 'themes/fixture.css')
  const style = buildContextStyle({ appearancePlugins: plugins })
  assert.match(style, /\[data-theme='fixture'\]\{[^}]*--odk-primary:#fafafa/)
  assert.equal(contextTokens('fixture', { appearancePlugins: plugins })['--odk-primary'], '#fafafa')
  await runtime.stop()
})

test('disabled appearance ports fall back without changing the remaining plugins', async () => {
  const runtime = createAppearanceHost({ disabled: ['odk.theme.pixel'] })
  await runtime.start()
  assert.equal(runtime.resolve('pixel').theme, 'instrument')
  assert.equal(runtime.resolve('border-beam').theme, 'border-beam')
  await runtime.setEnabled('odk.theme.pixel', true)
  assert.equal(runtime.resolve('pixel').theme, 'pixel')
  assert.equal(runtime.preview('pixel').theme, 'pixel')
  await runtime.setEnabled('odk.theme.border-beam', false)
  assert.equal(runtime.preview('border-beam').theme, 'instrument')
  await runtime.stop()
})

test('appearance replacements execute their selected factory and retain lifecycle ownership', async () => {
  const trace = []
  const plugins = createAppearancePlugins()
  const original = plugins[1]
  plugins[1] = { ...original, create(ctx) {
    trace.push('create')
    ctx.onCleanup(() => trace.push('cleanup'))
    return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) },
      start() { trace.push('start') }, stop() { trace.push('stop') }, destroy() { trace.push('destroy') } }
  } }
  const runtime = createAppearanceHost({ plugins })
  await runtime.start()
  assert.deepEqual(trace, ['create', 'start'])
  assert.deepEqual(runtime.resolve('pixel'), original.appearance)
  await runtime.setEnabled(original.manifest.id, false)
  assert.deepEqual(trace, ['create', 'start', 'stop', 'destroy', 'cleanup'])
  assert.equal(runtime.resolve('pixel').theme, 'instrument')
  await runtime.setEnabled(original.manifest.id, true)
  assert.deepEqual(trace.slice(-2), ['create', 'start'])
  await runtime.stop()
  assert.deepEqual(trace.slice(-3), ['stop', 'destroy', 'cleanup'])
})

test('trusted appearance factory selections preserve the complete selected declaration', async () => {
  const plugins = createAppearancePlugins()
  const original = plugins[1]
  let creates = 0
  const selected = selectAppearanceFactories(plugins, [{ ...original, manifest: { ...original.manifest, version: '2.0.0' },
    create() { creates++; return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) } } } }])
  assert.equal(creates, 0)
  const runtime = createAppearanceHost({ plugins: selected })
  await runtime.start()
  assert.equal(creates, 1)
  assert.equal(runtime.list()[1].manifest.version, '2.0.0')
  assert.deepEqual(runtime.resolve('pixel'), original.appearance)
  await runtime.stop()
})

test('invalid trusted appearance selections reject the whole candidate before any factory executes', () => {
  const plugins = createAppearancePlugins()
  let creates = 0
  const good = { ...plugins[1], create() { creates++ } }
  for (const bad of [
    { ...plugins[0], manifest: { ...plugins[0].manifest, permissions: ['outside'] } },
    { ...plugins[0], appearance: { ...plugins[0].appearance, faces: ['zpix'] } },
    { ...plugins[0], appearance: { theme: 'instrument', name: plugins[0].appearance.name, faces: plugins[0].appearance.faces } },
    { ...plugins[0], create: undefined },
  ]) assert.throws(() => selectAppearanceFactories(plugins, [good, bad]), /appearance/)
  assert.throws(() => selectAppearanceFactories(plugins, [good, good]), /appearance/)
  assert.equal(creates, 0)
})

test('appearance data equality ignores object key order and preserves face array shape', async () => {
  const plugins = createAppearancePlugins()
  const original = plugins[0]
  const reordered = Object.fromEntries(Object.entries(original.appearance).reverse())
  reordered.tokens = Object.fromEntries(Object.entries(original.appearance.tokens).reverse())
  const replacement = { ...original, appearance: reordered,
    create: () => ({ ports: { 'odk:theme/instrument/v1': reordered } }) }
  const runtime = createAppearanceHost({ plugins: selectAppearanceFactories(plugins, [replacement]) })
  await runtime.start()
  assert.deepEqual(runtime.resolve('instrument'), original.appearance)
  await runtime.stop()
  const sparse = structuredClone(original.appearance)
  sparse.faces.length++
  assert.throws(() => selectAppearanceFactories(plugins, [{ ...replacement, appearance: sparse }]), /appearance/)
})

test('appearance factory port mismatch releases its resources and preserves independent appearances', async () => {
  const trace = []
  const plugins = createAppearancePlugins()
  const original = plugins[1]
  plugins[1] = { ...original, create(ctx) {
    ctx.onCleanup(() => trace.push('cleanup'))
    return { ports: { 'odk:theme/pixel/v1': { ...original.appearance, faces: ['montserrat-bold'] } },
      start() { trace.push('start') }, stop() { trace.push('stop') }, destroy() { trace.push('destroy') } }
  } }
  const runtime = createAppearanceHost({ plugins })
  await runtime.start()
  assert.equal(runtime.list().find(plugin => plugin.manifest.id === original.manifest.id).state, 'failed')
  assert.deepEqual(trace, ['stop', 'destroy', 'cleanup'])
  assert.equal(runtime.resolve('pixel').theme, 'instrument')
  assert.equal(runtime.resolve('border-beam').theme, 'border-beam')
  await runtime.stop()
})

test('appearance factories reject omitted declaration fields and tokens before startup', async () => {
  for (const omitted of ['tokens', 'extra', '--odk-primary']) {
    const plugins = createAppearancePlugins()
    const original = plugins[0]
    const trace = []
    const value = structuredClone(original.appearance)
    if (omitted.startsWith('--')) delete value.tokens[omitted]
    else delete value[omitted]
    plugins[0] = { ...original, create(ctx) {
      ctx.onCleanup(() => trace.push('cleanup'))
      return { ports: { 'odk:theme/instrument/v1': value },
        start() { trace.push('start') }, stop() { trace.push('stop') }, destroy() { trace.push('destroy') } }
    } }
    const runtime = createAppearanceHost({ plugins })
    await runtime.start()
    assert.equal(runtime.list()[0].state, 'failed', omitted)
    assert.deepEqual(trace, ['stop', 'destroy', 'cleanup'])
    assert.equal(runtime.resolve('instrument'), null)
    assert.equal(runtime.resolve('pixel').theme, 'pixel')
    await runtime.stop()
  }
})

test('appearance factory cleanup failure retains ownership and retries without repeating completed phases', async () => {
  const trace = []
  let fail = true
  const plugins = createAppearancePlugins()
  const original = plugins[1]
  plugins[1] = { ...original, create() {
    trace.push('create')
    return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) },
      stop() { trace.push('stop'); if (fail) throw Error('retained') }, destroy() { trace.push('destroy') } }
  } }
  const runtime = createAppearanceHost({ plugins })
  await runtime.start()
  await runtime.setEnabled(original.manifest.id, false)
  assert.equal(runtime.list().find(plugin => plugin.manifest.id === original.manifest.id).state, 'cleanup-failed')
  await runtime.setEnabled(original.manifest.id, true)
  assert.equal(trace.filter(phase => phase === 'create').length, 1)
  fail = false
  await runtime.setEnabled(original.manifest.id, true)
  assert.equal(trace.filter(phase => phase === 'create').length, 2)
  assert.equal(trace.filter(phase => phase === 'destroy').length, 1)
  await runtime.stop()
})

test('appearance factory port getter and startup failures release owned resources', async () => {
  for (const stage of ['getter', 'startup']) {
    const trace = []
    const plugins = createAppearancePlugins()
    const original = plugins[1]
    plugins[1] = { ...original, create(ctx) {
      ctx.onCleanup(() => trace.push('cleanup'))
      const ports = { 'odk:theme/pixel/v1': structuredClone(original.appearance) }
      return { get ports() { if (stage === 'getter') throw Error('getter failed'); return ports },
        start() { ports['odk:theme/pixel/v1'].tokens['--odk-font'] = 'outside' },
        stop() { trace.push('stop') }, destroy() { trace.push('destroy') } }
    } }
    const runtime = createAppearanceHost({ plugins })
    await runtime.start()
    assert.equal(runtime.list().find(plugin => plugin.manifest.id === original.manifest.id).state, 'failed')
    assert.deepEqual(trace, ['stop', 'destroy', 'cleanup'])
    assert.equal(runtime.resolve('pixel').theme, 'instrument')
    await runtime.stop()
  }
})

test('shutdown during selected appearance factory creation drains its late instance', async () => {
  let release
  let started
  const began = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const trace = []
  const plugins = createAppearancePlugins()
  const original = plugins[1]
  plugins[1] = { ...original, async create(ctx) {
    ctx.onCleanup(() => trace.push('cleanup'))
    started()
    await gate
    return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) },
      start() { trace.push('start') }, stop() { trace.push('stop') }, destroy() { trace.push('destroy') } }
  } }
  const runtime = createAppearanceHost({ plugins })
  const starting = runtime.start()
  await began
  const stopping = runtime.stop()
  release()
  await Promise.all([starting, stopping])
  assert.deepEqual(trace, ['stop', 'destroy', 'cleanup'])
  assert.equal(runtime.resolve('pixel'), null)
})

test('appearance declarations refuse duplicate identities, unsafe styles, and undeclared fonts', () => {
  assert.throws(() => createAppearanceHost({ plugins: [...createAppearancePlugins(), createAppearancePlugins()[0]] }), /already registered/)
  for (const override of [
    { theme: 'x\' onclick=bad' }, { css: '../escape.css' }, { css: 'https://example.invalid/theme.css' },
    { faces: ['outside'] }, { tokens: { '--odk-primary': 'red;}body{background:red' } },
    { tokens: { '--odk-primary': 'url(https://example.invalid)' } },
    { tokens: { '--odk-bg': String.raw`u\72l(https://example.invalid/image)` } },
  ]) assert.throws(() => createAppearancePlugin({ theme: 'fixture', name: 'Fixture', faces: ['zpix'], ...override }), /invalid appearance/)
})

test('appearance metadata and live port values cannot be mutated through catalog reads', async () => {
  const plugin = customPlugin()
  const runtime = createAppearanceHost({ plugins: [...createAppearancePlugins(), plugin] })
  plugin.appearance.tokens['--odk-primary'] = 'url(https://example.invalid)'
  runtime.preview('fixture').theme = 'changed'
  await runtime.start()
  assert.equal(runtime.resolve('fixture').tokens['--odk-primary'], '#fafafa')
  runtime.resolve('fixture').tokens['--odk-primary'] = '#000000'
  assert.equal(runtime.resolve('fixture').tokens['--odk-primary'], '#fafafa')
  await runtime.stop()
})

test('the actual browser scripts preserve first paint, live selection and port disable/enable', async () => {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const path = require('node:path')
  const files = ['src/plugin-host.js', 'src/renderer/core/appearance-plugins.js', 'src/renderer/core/theme.js']
  let stored
  const window = { localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value } } }
  const document = { documentElement: { dataset: {} }, hidden: false, addEventListener() {} }
  const context = vm.createContext({ window, document, structuredClone, AbortController, console })
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context)
  assert.equal(window.odkTheme.get(), 'pixel', 'theme must be selected synchronously before body content')
  await window.odkTheme.ready
  assert.equal(window.odkTheme.catalog().map(entry => entry.state).join(','), 'running,running,running,running')
  window.odkTheme.set('border-beam')
  assert.equal(stored, 'border-beam')
  window.odkTheme.set('pixel')
  await window.odkTheme.setEnabled('odk.theme.pixel', false)
  assert.equal(window.odkTheme.get(), 'instrument')
  await window.odkTheme.setEnabled('odk.theme.pixel', true)
  assert.equal(window.odkTheme.get(), 'pixel')
  window.odkTheme.set('unknown')
  assert.equal(window.odkTheme.get(), 'instrument')
})

test('operator startup disables apply before first paint and preserve the saved appearance', async () => {
  const fs = require('node:fs')
  const vm = require('node:vm')
  const path = require('node:path')
  async function boot(storedValue, disabled) {
    let stored = storedValue
    const window = { location: { search: '?disabledPlugins=' + encodeURIComponent(disabled) },
      localStorage: { getItem: () => stored, setItem: (_key, value) => { stored = value } } }
    const document = { documentElement: { dataset: {} }, hidden: false, addEventListener() {} }
    const context = vm.createContext({ window, document, structuredClone, AbortController, URLSearchParams, console })
    for (const file of ['src/plugin-host.js', 'src/renderer/core/appearance-plugins.js', 'src/renderer/core/theme.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context)
    }
    const firstPaint = window.odkTheme.get()
    await window.odkTheme.ready
    return { window, firstPaint, stored: () => stored }
  }
  const disabled = await boot('pixel', 'odk.theme.pixel,odk.tile.clock')
  assert.equal(disabled.firstPaint, 'instrument')
  assert.equal(disabled.window.odkTheme.get(), 'instrument')
  assert.equal(disabled.window.odkTheme.catalog().find(item => item.manifest.id === 'odk.theme.pixel').state, 'disabled')
  assert.equal(disabled.stored(), 'pixel')
  const enabled = await boot(disabled.stored(), 'odk.tile.clock')
  assert.equal(enabled.firstPaint, 'pixel')
  assert.equal(enabled.window.odkTheme.get(), 'pixel')
  const unknown = await boot('unknown-theme', '')
  assert.equal(unknown.stored(), 'instrument')
})

const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept }); return { promise, resolve } }
function restorationFixture({ stop, defaultCreate } = {}) {
  const defaults = createAppearancePlugins()
  const original = defaults[1]
  const trace = []
  const builtin = original.create
  original.create = defaultCreate || (ctx => { trace.push('default:create'); return builtin(ctx) })
  const replacement = { ...original, manifest: { ...original.manifest, version: '2.0.0' },
    create(ctx) { trace.push('external:create'); ctx.onCleanup(() => trace.push('external:cleanup'))
      return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) },
        stop: stop || (() => trace.push('external:stop')) } } }
  const runtime = createAppearanceHost({ plugins: selectAppearanceFactories(defaults, [replacement]), defaults })
  return { runtime, defaults, original, trace }
}

test('Appearance restores a privately captured configured default and preserves independent factories', async () => {
  const f = restorationFixture()
  f.original.create = () => { throw Error('later default mutation') }
  f.original.manifest.version = '9.0.0'
  await f.runtime.start()
  const before = f.runtime.resolve('pixel')
  const result = await f.runtime.restoreDefault('odk.theme.pixel')
  assert.deepEqual(result, { implementation: 'built-in', version: '1.0.0', state: 'running' })
  assert.equal(f.runtime.list()[1].manifest.version, '1.0.0')
  assert.deepEqual(f.runtime.resolve('pixel'), before)
  assert.equal(f.runtime.list()[0].state, 'running')
  assert.deepEqual(f.trace, ['external:create', 'external:stop', 'external:cleanup', 'default:create'])
  await f.runtime.stop()
})

test('Appearance restoration refuses disabled, queued disabled, and uncaptured identities', async () => {
  const f = restorationFixture()
  await f.runtime.start()
  const disabled = f.runtime.setEnabled('odk.theme.pixel', false)
  const restored = assert.rejects(f.runtime.restoreDefault('odk.theme.pixel'), /enabled/)
  await disabled; await restored
  await assert.rejects(f.runtime.restoreDefault('odk.theme.pixel'), /enabled/)
  await assert.rejects(f.runtime.restoreDefault('odk.theme.unknown'), /default/)
  assert.equal(f.trace.includes('default:create'), false)
  await f.runtime.stop()
})

test('Appearance retained cleanup prevents default construction until explicit retry', async () => {
  let refuse = true
  const f = restorationFixture({ stop() { if (refuse) throw Error('external retained') } })
  await f.runtime.start()
  await assert.rejects(f.runtime.restoreDefault('odk.theme.pixel'), /retains resources/)
  assert.equal(f.trace.includes('default:create'), false)
  assert.equal(f.runtime.list()[1].manifest.version, '2.0.0')
  refuse = false
  await f.runtime.restoreDefault('odk.theme.pixel')
  assert.equal(f.trace.filter(phase => phase === 'default:create').length, 1)
  await f.runtime.stop()
})

test('Appearance failed default startup restores the external factory without a success receipt', async () => {
  const f = restorationFixture({ defaultCreate() { throw Error('default unavailable') } })
  await f.runtime.start()
  await assert.rejects(f.runtime.restoreDefault('odk.theme.pixel'), /replacement failed/)
  assert.equal(f.runtime.list()[1].manifest.version, '2.0.0')
  assert.equal(f.runtime.resolve('pixel').theme, 'pixel')
  assert.equal(f.trace.filter(phase => phase === 'external:create').length, 2)
  await f.runtime.stop()
})

test('Appearance shutdown fences default construction after delayed external cleanup', async () => {
  const entered = deferred(); const finish = deferred()
  const f = restorationFixture({ stop() { entered.resolve(); return finish.promise } })
  await f.runtime.start()
  const restored = assert.rejects(f.runtime.restoreDefault('odk.theme.pixel'), /shutdown|cancelled/)
  await entered.promise
  const stopped = f.runtime.stop()
  finish.resolve()
  await restored; await stopped
  assert.equal(f.trace.includes('default:create'), false)
  assert.equal(f.runtime.resolve('pixel'), null)
})

test('Appearance disable immediately cancels a pending enable factory', async () => {
  const entered = deferred()
  let creates = 0
  let signal
  const plugins = createAppearancePlugins()
  const original = plugins[1]
  const external = { ...original, create: async ctx => {
    if (++creates === 2) {
      signal = ctx.signal
      entered.resolve()
      await new Promise(resolve => ctx.signal.addEventListener('abort', resolve, { once: true }))
    }
    return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) } }
  } }
  const runtime = createAppearanceHost({ plugins: selectAppearanceFactories(plugins, [external]), defaults: plugins })
  await runtime.start()
  await runtime.setEnabled('odk.theme.pixel', false)
  const enabled = runtime.setEnabled('odk.theme.pixel', true)
  await entered.promise
  const disabled = runtime.setEnabled('odk.theme.pixel', false)
  try { assert.equal(signal.aborted, true, 'disable must reach the Host before enable settles') }
  finally { await runtime.stop(); await Promise.allSettled([enabled, disabled]) }
  assert.equal(runtime.resolve('pixel'), null)
})

test('Appearance disable cancels pending default construction and prevents a recovery receipt', async () => {
  const entered = deferred()
  let signal
  const builtin = createAppearancePlugins()[1].create
  const f = restorationFixture({ defaultCreate: async ctx => {
    signal = ctx.signal
    entered.resolve()
    await new Promise(resolve => ctx.signal.addEventListener('abort', resolve, { once: true }))
    return builtin(ctx)
  } })
  await f.runtime.start()
  const restored = assert.rejects(f.runtime.restoreDefault('odk.theme.pixel'), /incomplete/)
  await entered.promise
  const disabled = f.runtime.setEnabled('odk.theme.pixel', false)
  try {
    assert.equal(signal.aborted, true)
    await restored; await disabled
    assert.equal(f.runtime.list()[1].state, 'disabled')
    assert.equal(f.runtime.resolve('pixel').theme, 'instrument')
  } finally { await f.runtime.stop(); await Promise.allSettled([restored, disabled]) }
})

test('Appearance disable during external cleanup prevents default construction', async () => {
  const entered = deferred(); const finish = deferred()
  const f = restorationFixture({ stop() { entered.resolve(); return finish.promise } })
  await f.runtime.start()
  const restored = assert.rejects(f.runtime.restoreDefault('odk.theme.pixel'), /incomplete/)
  await entered.promise
  const disabled = f.runtime.setEnabled('odk.theme.pixel', false)
  finish.resolve()
  await restored; await disabled
  assert.equal(f.trace.includes('default:create'), false)
  assert.equal(f.runtime.list()[1].state, 'disabled')
  await f.runtime.stop()
})

test('Appearance runtime replacement executes an independent factory and preserves declared consumers', async () => {
  const runtime = createAppearanceHost()
  await runtime.start()
  const data = runtime.resolve('pixel')
  let creates = 0; let cleanups = 0
  const replacement = { manifest: { ...createAppearancePlugins()[1].manifest, version: '4.0.0' }, appearance: data,
    create(ctx) { creates++; ctx.onCleanup(() => { cleanups++ }); return { ports: { 'odk:theme/pixel/v1': structuredClone(data) } } } }
  await runtime.replace(replacement)
  assert.equal(creates, 1)
  assert.equal(runtime.list()[1].manifest.version, '4.0.0')
  assert.deepEqual(runtime.resolve('pixel'), data)
  await assert.rejects(runtime.replace({ ...replacement, appearance: { ...data, name: 'Changed context' } }), /declaration/)
  assert.equal(cleanups, 0)
  await runtime.restoreDefault('odk.theme.pixel')
  assert.equal(cleanups, 1)
  await runtime.stop()
})

test('Appearance runtime replacement rejects disabled identities and rolls back failed candidates', async () => {
  const runtime = createAppearanceHost()
  await runtime.start()
  const original = createAppearancePlugins()[1]
  const replacement = { ...original, manifest: { ...original.manifest, version: '4.0.0' }, create() { throw Error('controlled startup failure') } }
  await assert.rejects(runtime.replace(replacement), /replacement failed/)
  assert.equal(runtime.list()[1].manifest.version, '1.0.0')
  assert.equal(runtime.resolve('pixel').theme, 'pixel')
  await runtime.setEnabled('odk.theme.pixel', false)
  await assert.rejects(runtime.replace(original), /enabled/)
  await runtime.stop()
})

for (const phase of ['create', 'start']) test(`Appearance activation cancellation drains candidate ${phase} and restores the previous factory`, async () => {
  const entered = deferred(); const finish = deferred(); const controller = new AbortController()
  const runtime = createAppearanceHost()
  await runtime.start()
  const original = createAppearancePlugins()[1]
  let candidateSignal; let stops = 0; let cleanups = 0
  const candidate = { ...original, manifest: { ...original.manifest, version: '4.0.0' }, async create(ctx) {
    candidateSignal = ctx.signal
    ctx.onCleanup(() => { cleanups++ })
    if (phase === 'create') { entered.resolve(); await finish.promise }
    return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) },
      async start() { if (phase === 'start') { entered.resolve(); await finish.promise } }, stop() { stops++ } }
  } }
  const operation = runtime.replace(candidate, { signal: controller.signal })
  const outcome = operation.then(() => null, error => error)
  await entered.promise
  controller.abort()
  try {
    assert.equal(candidateSignal.aborted, true, 'caller cancellation must reach the candidate')
    finish.resolve()
    assert.match((await outcome)?.message || '', /replacement failed|cancelled|aborted/)
    assert.equal(runtime.list()[1].manifest.version, '1.0.0')
    assert.equal(runtime.list()[1].state, 'running')
    assert.equal(stops, 1)
    assert.equal(cleanups, 1)
  } finally { finish.resolve(); await outcome; await runtime.stop() }
})

test('completed Appearance activation releases request authority for enable rollback and restart', async () => {
  const runtime = createAppearanceHost()
  await runtime.start()
  const controller = new AbortController()
  const original = createAppearancePlugins()[1]
  let creates = 0
  const candidate = { ...original, manifest: { ...original.manifest, version: '4.0.0' }, create(ctx) {
    assert.equal(ctx.signal.aborted, false)
    creates++
    return { ports: { 'odk:theme/pixel/v1': structuredClone(original.appearance) } }
  } }
  try {
    await runtime.replace(candidate, { signal: controller.signal })
    controller.abort()
    assert.equal(runtime.list()[1].state, 'running')
    await runtime.setEnabled('odk.theme.pixel', false)
    await runtime.setEnabled('odk.theme.pixel', true)
    assert.equal(runtime.list()[1].state, 'running')
    assert.equal(creates, 2)
    await assert.rejects(runtime.replace({ ...candidate, manifest: { ...candidate.manifest, version: '5.0.0' },
      create() { throw Error('controlled later candidate failure') } }), /replacement failed/)
    assert.equal(runtime.list()[1].manifest.version, '4.0.0')
    assert.equal(runtime.list()[1].state, 'running')
    assert.equal(creates, 3)
    await runtime.stop()
    await runtime.start()
    assert.equal(runtime.list()[1].state, 'running')
    assert.equal(creates, 4)
  } finally { await runtime.stop() }
})

test('Appearance abort and disable during previous cleanup retain the previous factory for later enable', async () => {
  const entered = deferred(); const finish = deferred(); const controller = new AbortController()
  const f = restorationFixture({ stop() { entered.resolve(); return finish.promise } })
  await f.runtime.start()
  const candidate = { ...f.original, manifest: { ...f.original.manifest, version: '4.0.0' } }
  const replacement = assert.rejects(f.runtime.replace(candidate, { signal: controller.signal }), /cancelled|incomplete/)
  await entered.promise
  controller.abort()
  const disabled = f.runtime.setEnabled('odk.theme.pixel', false)
  finish.resolve()
  await replacement; await disabled
  try {
    assert.equal(f.runtime.list()[1].manifest.version, '2.0.0')
    await f.runtime.setEnabled('odk.theme.pixel', true)
    assert.equal(f.runtime.list()[1].state, 'running')
    assert.equal(f.runtime.list()[1].manifest.version, '2.0.0')
    assert.equal(f.trace.includes('default:create'), false)
  } finally { await f.runtime.stop() }
})
