const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const registrySource = fs.readFileSync('src/renderer/core/registry.js', 'utf8')

function createFakeDocument() {
  const children = []
  const head = {
    children,
    appendChild(node) {
      node.parentNode = head
      children.push(node)
      doc.onInsert?.(node)
      return node
    },
    insertBefore(node, ref) {
      node.parentNode = head
      if (!ref) {
        children.push(node)
        doc.onInsert?.(node)
        return node
      }
      const index = children.indexOf(ref)
      if (index === -1) children.push(node)
      else children.splice(index, 0, node)
      doc.onInsert?.(node)
      return node
    },
  }
  const shellLink = {
    tag: 'link',
    href: 'shell.css',
    parentNode: head,
    get nextSibling() {
      const index = children.indexOf(shellLink)
      return children[index + 1] || null
    },
  }
  children.push(shellLink)
  const doc = {
    head,
    createElement(tag) {
      return {
        tag,
        rel: '',
        href: '',
        attrs: {},
        dataset: {},
        parentNode: null,
        setAttribute(key, value) {
          this.attrs[key] = value
          if (key === 'data-plugin') this.dataset.plugin = value
        },
        getAttribute(key) {
          return this.attrs[key] || null
        },
        removeAttribute(key) {
          delete this.attrs[key]
          if (key === 'data-plugin') delete this.dataset.plugin
        },
        remove() {
          const index = children.indexOf(this)
          if (index !== -1) children.splice(index, 1)
          this.parentNode = null
        },
      }
    },
    querySelector(selector) {
      const pluginMatch = selector.match(/^link\[data-plugin="([^"]+)"\]$/)
      if (pluginMatch) {
        return children.find((node) => node.tag === 'link' && (node.dataset?.plugin === pluginMatch[1] || node.attrs?.['data-plugin'] === pluginMatch[1])) || null
      }
      if (selector === 'link[href$="shell.css"]') return shellLink
      return null
    },
  }
  return doc
}

function createRegistry(doc) {
  const root = { document: doc, odkPluginHost: require('../src/plugin-host') }
  vm.runInContext(registrySource, vm.createContext({ window: root, structuredClone, setTimeout, clearTimeout,
    console: { error() {} }, globalThis: root, document: doc }))
  return root.odkPlugins
}

function tile(id, extra = {}) {
  return {
    id,
    kind: 'tile',
    interaction: 'display-only',
    manifest: { schemaVersion: 1 },
    mount() {},
    ...extra,
  }
}

function fakeEl() {
  return { replaceChildren() {} }
}

function fakeCtx() {
  return { onTick: () => () => {} }
}

test('plugin with css injects a scoped stylesheet on activate after shell.css', () => {
  const doc = createFakeDocument()
  const registry = createRegistry(doc)
  const def = tile('odk.tile.weread', { css: 'plugins/weread.css' })
  registry.register(def)
  registry.activate(registry.get('odk.tile.weread'), fakeEl(), fakeCtx())
  const link = doc.querySelector('link[data-plugin="odk.tile.weread"]')
  assert.ok(link, 'expected a scoped stylesheet link')
  assert.equal(link.href, 'plugins/weread.css')
  assert.equal(link.rel, 'stylesheet')
  const order = doc.head.children.map((node) => node.href || node.tag)
  assert.ok(order.indexOf('shell.css') < order.indexOf('plugins/weread.css'), 'plugin styles must load after shell.css')
})

test('repeated activation does not duplicate the stylesheet', () => {
  const doc = createFakeDocument()
  const registry = createRegistry(doc)
  registry.register(tile('odk.tile.weread', { css: 'plugins/weread.css' }))
  const def = registry.get('odk.tile.weread')
  registry.activate(def, fakeEl(), fakeCtx())
  registry.activate(def, fakeEl(), fakeCtx())
  const count = doc.head.children.filter((node) => node.attrs?.['data-plugin'] === 'odk.tile.weread').length
  assert.equal(count, 1)
})

test('plugin without css injects nothing', () => {
  const doc = createFakeDocument()
  const registry = createRegistry(doc)
  registry.register(tile('odk.tile.clock'))
  registry.activate(registry.get('odk.tile.clock'), fakeEl(), fakeCtx())
  assert.equal(doc.querySelector('link[data-plugin="odk.tile.clock"]'), null)
})

test('invalid css declaration is rejected at registration', () => {
  const registry = createRegistry()
  assert.throws(() => registry.register(tile('odk.tile.evil', { css: '../outside.css' })), /invalid css/)
  assert.throws(() => registry.register(tile('odk.tile.evil2', { css: 'https://evil/x.css' })), /invalid css/)
  assert.throws(() => registry.register(tile('odk.tile.evil3', { css: 'plugins/x.js' })), /invalid css/)
})

test('deactivation keeps the stylesheet loaded', () => {
  const doc = createFakeDocument()
  const registry = createRegistry(doc)
  registry.register(tile('odk.tile.weread', { css: 'plugins/weread.css' }))
  const def = registry.get('odk.tile.weread')
  const el = fakeEl()
  registry.activate(def, el, fakeCtx())
  registry.deactivate(def, el, fakeCtx())
  assert.ok(doc.querySelector('link[data-plugin="odk.tile.weread"]'), 'stylesheet must survive deactivation')
})


test('trusted development stylesheet preparation preserves relative declarations and maps only the selected definition', async () => {
  const doc = createFakeDocument()
  const registry = createRegistry(doc)
  const original = tile('odk.tile.clock')
  registry.register(original)
  const replacement = tile(original.id, { css: 'clock.css', manifest: { schemaVersion: 1, css: 'clock.css' } })
  assert.throws(() => registry.prepareDevelopmentStylesheet(replacement, 'https://example.invalid/clock.css'), /invalid/)
  registry.prepareDevelopmentStylesheet(replacement, 'file:///package/clock.css')
  const unprepared = tile('odk.tile.other', { css: 'clock.css' })
  registry.register(unprepared)
  await registry.start({ replacements: [replacement] })
  registry.activate(registry.get(original.id), fakeEl(), fakeCtx())
  registry.activate(registry.get(unprepared.id), fakeEl(), fakeCtx())
  assert.equal(doc.querySelector('link[data-plugin="odk.tile.clock"]').href, 'file:///package/clock.css')
  assert.equal(doc.querySelector('link[data-plugin="odk.tile.other"]').href, 'clock.css')
  assert.throws(() => registry.prepareDevelopmentStylesheet(replacement, 'file:///package/clock.css'), /before startup/)
  await registry.stop()
})

const deferred = () => { let resolve; const promise = new Promise(accept => { resolve = accept }); return { promise, resolve } }
async function recoveryFixture({ css = 'plugins/default.css', mount, create, unmount } = {}) {
  const doc = createFakeDocument()
  const registry = createRegistry(doc)
  const id = 'odk.tile.recovery'
  const element = { text: '', isConnected: true, replaceChildren() { this.text = '' } }
  const original = tile(id, { css, manifest: { schemaVersion: 1, version: '1.0.0', ...(css ? { css } : {}) },
    create, mount: mount || (el => { el.text = 'default' }) })
  registry.register(original)
  const external = tile(id, { css: 'external.css', manifest: { schemaVersion: 1, version: '2.0.0', css: 'external.css' },
    unmount, mount(el) { el.text = 'external' } })
  registry.prepareDevelopmentStylesheet(external, 'file:///package/external.css')
  await registry.start({ replacements: [external] })
  registry.activate(registry.get(id), element, fakeCtx())
  const previous = doc.querySelector(`link[data-plugin="${id}"]`)
  const inserted = deferred()
  doc.onInsert = link => { if (link.media === 'not all') inserted.resolve(link) }
  return { doc, registry, id, original, element, previous, inserted,
    link: () => doc.querySelector(`link[data-plugin="${id}"]`) }
}

test('recovery stages default CSS without applying it and switches only after external cleanup', async () => {
  const entered = deferred(); const released = deferred()
  const f = await recoveryFixture({ unmount() { entered.resolve(); return released.promise } })
  const recovery = f.registry.restoreDefault(f.id)
  const staged = await f.inserted.promise
  assert.equal(staged.media, 'not all')
  assert.equal(f.previous.disabled, undefined)
  assert.equal(f.element.text, 'external')
  staged.onload()
  await entered.promise
  assert.equal(f.link(), f.previous)
  assert.equal(f.previous.disabled, undefined)
  assert.equal(staged.media, 'not all')
  released.resolve()
  const result = await recovery
  assert.equal(result.implementation, 'built-in')
  assert.equal(f.link(), staged)
  assert.equal(staged.media, '')
  assert.equal(staged.href, 'plugins/default.css')
  assert.equal(f.previous.parentNode, null)
  assert.equal(f.element.text, 'default')
  await f.registry.stop()
})

test('unavailable default stylesheet rejects before external release or default construction', async () => {
  let released = 0; let created = 0
  const f = await recoveryFixture({ unmount() { released++ }, create() { created++; return {} } })
  const recovery = f.registry.restoreDefault(f.id)
  const rejected = assert.rejects(recovery, /stylesheet unavailable/)
  const staged = await f.inserted.promise
  staged.onerror()
  await rejected
  assert.equal(released, 0)
  assert.equal(created, 0)
  assert.equal(f.link(), f.previous)
  assert.equal(f.element.text, 'external')
  assert.equal(staged.parentNode, null)
  await f.registry.stop()
})

for (const phase of ['factory', 'mount']) test(`failed default ${phase} restores the external stylesheet and surface`, async () => {
  const f = await recoveryFixture({
    ...(phase === 'factory' ? { create() { throw Error('default factory failed') } }
      : { mount() { throw Error('default mount failed') } }),
  })
  const recovery = f.registry.restoreDefault(f.id)
  const rejected = assert.rejects(recovery, /replacement failed|restoration failed/)
  const staged = await f.inserted.promise
  staged.onload()
  await rejected
  assert.equal(f.link(), f.previous)
  assert.equal(f.previous.disabled, undefined)
  assert.equal(staged.parentNode, null)
  assert.equal(f.registry.get(f.id).manifest.version, '2.0.0')
  assert.equal(f.element.text, 'external')
  await f.registry.stop()
})

test('failed external cleanup keeps its stylesheet and discards staged default CSS until retry', async () => {
  let refuse = true
  const f = await recoveryFixture({ unmount() { if (refuse) throw Error('external retained') } })
  const recovery = f.registry.restoreDefault(f.id)
  const rejected = assert.rejects(recovery, /retains resources/)
  const staged = await f.inserted.promise
  staged.onload()
  await rejected
  assert.equal(f.link(), f.previous)
  assert.equal(staged.parentNode, null)
  refuse = false
  f.doc.onInsert = link => queueMicrotask(() => link.onload?.())
  await f.registry.restoreDefault(f.id)
  assert.equal(f.link().href, 'plugins/default.css')
  assert.equal(f.element.text, 'default')
  await f.registry.stop()
})

test('retained failed default cleanup keeps its stylesheet until explicit successful recovery', async () => {
  let refuse = true
  const f = await recoveryFixture({ mount(el, ctx) {
    ctx.trackCleanup(() => { if (refuse) throw Error('default retained') })
    if (refuse) throw Error('default mount failed')
    el.text = 'default'
  } })
  const recovery = f.registry.restoreDefault(f.id)
  const rejected = assert.rejects(recovery, /retains resources/)
  const staged = await f.inserted.promise
  staged.onload()
  await rejected
  assert.equal(f.link(), staged)
  assert.equal(staged.media, '')
  assert.equal(f.previous.parentNode, null)
  assert.equal(f.registry.get(f.id).manifest.version, '1.0.0')
  refuse = false
  await f.registry.restoreDefault(f.id)
  assert.equal(f.link(), staged)
  assert.equal(f.element.text, 'default')
  await f.registry.stop()
})

test('shutdown cancels staged stylesheet loading and late completion cannot construct defaults', async () => {
  let created = 0
  const f = await recoveryFixture({ create() { created++; return {} } })
  const recovery = f.registry.restoreDefault(f.id)
  const rejected = assert.rejects(recovery, /cancelled|shutdown/)
  const staged = await f.inserted.promise
  const lateLoad = staged.onload
  await f.registry.stop()
  await rejected
  lateLoad()
  assert.equal(created, 0)
  assert.equal(staged.parentNode, null)
  assert.equal(f.link(), f.previous)
})

test('recovery to a default without CSS removes only the released external stylesheet', async () => {
  const doc = createFakeDocument(); const registry = createRegistry(doc)
  const original = tile('odk.tile.plain')
  registry.register(original)
  const external = tile(original.id, { css: 'external.css', manifest: { schemaVersion: 1, css: 'external.css' } })
  registry.prepareDevelopmentStylesheet(external, 'file:///package/external.css')
  await registry.start({ replacements: [external] })
  registry.activate(registry.get(original.id), fakeEl(), fakeCtx())
  const previous = doc.querySelector(`link[data-plugin="${original.id}"]`)
  await registry.restoreDefault(original.id)
  assert.equal(previous.parentNode, null)
  assert.equal(doc.head.children.length, 1)
  await registry.stop()
})

test('queued ordinary replacement rechecks stylesheet binding after default recovery', async () => {
  const f = await recoveryFixture()
  const recovery = f.registry.restoreDefault(f.id)
  const staged = await f.inserted.promise
  const replacement = f.registry.get(f.id)
  // Pass the admitted definition so its private external binding survives admission.
  const replacing = f.registry.replace(replacement)
  let settled = false
  void replacing.then(() => { settled = true }, () => { settled = true })
  const rejected = assert.rejects(replacing, /stylesheet contract/)
  await Promise.resolve()
  assert.equal(settled, false)
  staged.onload()
  await recovery
  await rejected
  assert.equal(f.link(), staged)
  assert.equal(f.element.text, 'default')
  await f.registry.stop()
})

test('ordinary replacement cannot opt into built-in stylesheet recovery', async () => {
  const f = await recoveryFixture()
  await assert.rejects(f.registry.replace(f.original, { recovery: true }), /stylesheet contract/)
  assert.equal(f.link(), f.previous)
  assert.equal(f.element.text, 'external')
  await f.registry.stop()
})
