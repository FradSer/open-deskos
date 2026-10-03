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
      return node
    },
    insertBefore(node, ref) {
      node.parentNode = head
      if (!ref) {
        children.push(node)
        return node
      }
      const index = children.indexOf(ref)
      if (index === -1) children.push(node)
      else children.splice(index, 0, node)
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
  const root = doc ? { document: doc } : {}
  vm.runInContext(registrySource, vm.createContext({ window: root, globalThis: root, document: doc }))
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
