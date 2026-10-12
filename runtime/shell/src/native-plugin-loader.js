'use strict'

const path = require('node:path')
const { compileFunction } = require('node:vm')
const { createRequire } = require('node:module')
const { createNativePluginStore } = require('./native-plugin-store')
const { readNativeKeyring } = require('./native-plugin-policy')
const { resolveShellHost } = require('./platform')
const { createTrustedPluginDefinition } = require('./development-plugins')

// Captured CommonJS module inputs have signature integrity. Trusted native code
// still has full process authority; this is not a sandbox.
function capturedModule(plugin) {
  const files = new Map([...plugin.files].map(([name, bytes]) => [name, Buffer.from(bytes)]))
  const cache = new Map()
  const runtimeRequire = createRequire(__filename)
  function resolve(name, visited = new Set()) {
    name = path.posix.normalize(name)
    if (name.startsWith('../') || name === '..' || path.posix.isAbsolute(name)) throw Error('native module escapes signed bundle')
    if (visited.has(name)) throw Error('invalid native module resolution')
    visited.add(name)
    for (const candidate of [name, `${name}.js`, `${name}.cjs`, `${name}.json`]) {
      if (files.has(candidate)) return candidate
    }
    const packageBytes = files.get(path.posix.join(name, 'package.json'))
    if (packageBytes) {
      const main = JSON.parse(packageBytes.toString('utf8')).main
      if (typeof main === 'string' && !visited.has(path.posix.normalize(path.posix.join(name, main)))) {
        try { return resolve(path.posix.join(name, main), visited) } catch (error) {
          if (error.code !== 'MODULE_NOT_FOUND') throw error
        }
      }
    }
    for (const candidate of ['index.js', 'index.cjs', 'index.json'].map(file => path.posix.join(name, file))) {
      if (files.has(candidate)) return candidate
    }
    throw Object.assign(Error('native module is absent from signed bundle'), { code: 'MODULE_NOT_FOUND' })
  }
  function load(name) {
    name = resolve(name)
    if (cache.has(name)) return cache.get(name).exports
    const filename = path.join(plugin.root, ...name.split('/'))
    const module = { exports: {}, filename, id: filename, loaded: false }
    cache.set(name, module)
    try {
      const source = files.get(name).toString('utf8').replace(/^\uFEFF/, '')
      if (name.endsWith('.json')) module.exports = JSON.parse(source)
      else {
        if (!/\.(?:js|cjs)$/.test(name)) throw Error('native startup requires CommonJS or JSON modules')
        const requireCaptured = request => {
          if (typeof request !== 'string' || !request) throw Error('invalid native module request')
          if (request.startsWith('.')) return load(path.posix.join(path.posix.dirname(name), request))
          if (path.isAbsolute(request) || request.includes('\\')) throw Error('native module requires a relative or runtime dependency')
          return runtimeRequire(request)
        }
        compileFunction(source.replace(/^#![^\n]*/, ''), ['exports', 'require', 'module', '__filename', '__dirname'], { filename })
          .call(module.exports, module.exports, requireCaptured, module, filename, path.dirname(filename))
      }
      module.loaded = true
      return module.exports
    } catch (error) {
      cache.delete(name)
      throw error
    }
  }
  const entry = path.relative(plugin.root, plugin.entry).split(path.sep).join('/')
  return () => load(entry)
}

async function loadNativeSelections(config, { store, env = process.env, disabled = [], existingPlugins = [], report, host = 'electron-main', appearance = false } = {}) {
  const excluded = new Set(disabled)
  const selected = Object.entries(config.plugins || {}).filter(([id, preference]) => preference.native?.host === host
    && id.startsWith('odk.theme.') === appearance
    && preference.enabled !== false && !excluded.has(id))
  if (!selected.length) return []
  const reject = (id, error) => {
    if (!report) throw error
    report(id, error)
  }
  if (!store) {
    try {
      if (!env.ODK_NATIVE_KEYRING) throw Error('native startup requires explicit publisher policy')
      const keyring = await readNativeKeyring(path.resolve(env.ODK_NATIVE_KEYRING))
      store = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins', 'native'), keyring })
    } catch (error) {
      for (const [id] of selected) reject(id, error)
      return []
    }
  }
  const plugins = []
  const namespaces = existingPlugins.map(plugin => plugin.manifest.id)
  for (const [id, preference] of selected) {
    try {
      const selection = preference.native
      if (preference.development) throw Error('native plugin ownership conflicts with development link')
      if (!selection.trustAcknowledgedAt || !Number.isFinite(Date.parse(selection.trustAcknowledgedAt))) throw Error('native startup requires explicit trust')
      const plugin = await store.snapshot(selection.revision)
      if (plugin.manifest.id !== id || plugin.manifest.host !== selection.host || plugin.replacement !== selection.replace) throw Error('native selection identity changed')
      if (namespaces.some(other => id === other || id.startsWith(`${other}.`) || other.startsWith(`${id}.`))) throw Error('native plugin reading namespaces overlap')
      const grants = selection.grants
      if (!Array.isArray(grants) || new Set(grants).size !== grants.length || grants.length !== plugin.manifest.permissions.length
        || plugin.manifest.permissions.some(name => !grants.includes(name))) throw Error('native startup requires exact grants')
      plugins.push(plugin)
      namespaces.push(id)
    } catch (error) { reject(id, error) }
  }
  return plugins
}

async function loadNativePlugins(config, options = {}) {
  const plugins = await loadNativeSelections(config, options)
  return plugins.map(plugin => {
    const load = capturedModule(plugin)
    return createTrustedPluginDefinition(plugin, { replacement: plugin.replacement, load: ctx => {
      if (ctx.signal.aborted) throw Error('native startup cancelled')
      return load()
    } })
  })
}

async function loadNativeRendererPlugins(config, options = {}) {
  const plugins = await loadNativeSelections(config, { ...options, host: 'electron-renderer' })
  const entries = []
  for (const plugin of plugins) {
    try {
      if ((options.existingPlugins?.length || 0) + entries.length >= 32) throw Error('Renderer startup entry limit exceeded')
      entries.push(options.assets.publish(plugin))
    } catch (error) {
      if (!options.report) throw error
      options.report(plugin.manifest.id, error)
    }
  }
  return entries
}

async function loadNativeAppearancePlugins(config, options = {}) {
  const plugins = await loadNativeSelections(config, { ...options, host: 'electron-renderer', appearance: true })
  const entries = []
  for (const plugin of plugins) {
    try { entries.push(plugin.entry ? options.assets.publish(plugin) : { manifest: plugin.manifest }) } catch (error) {
      if (!options.report) throw error
      options.report(plugin.manifest.id, error)
    }
  }
  return entries
}

module.exports = { loadNativePlugins, loadNativeRendererPlugins, loadNativeAppearancePlugins }
