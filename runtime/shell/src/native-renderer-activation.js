'use strict'

const { readConfig, resolveConfigPath } = require('./plugin-config')
const { loadNativeRendererPlugins, loadNativeAppearancePlugins } = require('./native-plugin-loader')

function createNativeRendererActivator({ env = process.env, configPath = resolveConfigPath(env), assets,
  entries = () => [], publishSelection, load }) {
  const captures = new Map()
  return async (id, { signal } = {}) => {
    let preparing = true
    const requireAvailable = () => {
      if (signal?.aborted) throw Error('native Renderer activation cancelled')
      if (!preparing) throw Error('native Renderer preparation is closed')
      const config = readConfig(configPath)
      const preference = config.plugins[id]
      if (!preference?.native || preference.native.host !== 'electron-renderer'
        || preference.enabled === false || (env.ODESK_DISABLED_PLUGINS || '').split(/[\s,]+/).includes(id)) {
        throw Error('native activation requires an enabled signed Renderer selection')
      }
      return { config, preference }
    }
    const { config, preference } = requireAvailable()
    const peers = () => entries().filter(entry => entry.manifest.id !== id)
    const existingPlugins = peers()
    if (existingPlugins.length >= 32) throw Error('Renderer discovery entry limit exceeded')
    // Startup's loader owns current policy and signed-byte verification. The
    // operator supplies only identity; publication remains Main-owned.
    const retained = new Set()
    try {
      const loader = load || (id.startsWith('odk.theme.') ? loadNativeAppearancePlugins : loadNativeRendererPlugins)
      const selections = await loader({ version: config.version, plugins: { [id]: preference } }, {
        env, existingPlugins,
        assets: { publish(plugin) {
          requireAvailable()
          if (plugin.css !== undefined || plugin.manifest?.css !== undefined) throw Error('runtime Renderer stylesheet loading is not supported')
          const key = `${id}:${preference.native.revision}`
          let capture = captures.get(key)
          if (!capture) {
            capture = { entry: assets.publish(plugin), owners: 0, published: false, key }
            captures.set(key, capture)
          }
          if (!retained.has(capture)) { capture.owners++; retained.add(capture) }
          return capture.entry
        } },
      })
      requireAvailable()
      const entry = selections[0]
      if (selections.length !== 1 || entry?.manifest?.id !== id || typeof entry.entryUrl !== 'string') throw Error('native Renderer activation selection unavailable')
      if (peers().length >= 32) throw Error('Renderer discovery entry limit exceeded')
      // Publication may expose the URL before its callback returns. From this
      // point, an error or cancellation cannot prove that the browser has no owner.
      for (const capture of retained) capture.published = true
      publishSelection(entry)
      return { revision: preference.native.revision, version: entry.manifest.version, entryUrl: entry.entryUrl }
    } finally {
      preparing = false
      for (const capture of retained) {
        capture.owners--
        if (!capture.published && capture.owners === 0) {
          captures.delete(capture.key)
          assets.retire(capture.entry.entryUrl)
        }
      }
    }
  }
}

module.exports = { createNativeRendererActivator }
