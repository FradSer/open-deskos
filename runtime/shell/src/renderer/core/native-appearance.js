;(function (root) {
  'use strict'

  let active = null
  let activeError = null
  let activeScript = null
  let pending = Promise.resolve()
  const definitions = new Map()
  const api = root.odkAppearancePlugins
  function define(definition) {
    if (!activeScript || root.document.currentScript !== activeScript) throw Error('Appearance definition requires its executing selected script')
    if (!active || definition?.id !== active.manifest.id || definitions.has(definition.id)) {
      activeError = Error('Appearance entry must define its selected identity once')
      throw activeError
    }
    definitions.set(definition.id, { manifest: active.manifest, appearance: definition.appearance, create: definition.create })
  }

  function load(plugins, options = {}) {
    const result = pending.then(() => loadSelected(plugins, options))
    pending = result.catch(() => {})
    return result
  }

  async function loadSelected(plugins, { signal, runtime = false, pluginId, entryUrl } = {}) {
    signal?.throwIfAborted()
    if (typeof runtime !== 'boolean' || ((pluginId !== undefined || entryUrl !== undefined)
      && (!runtime || typeof pluginId !== 'string' || !/^odk\.theme\.[a-z0-9-]+$/.test(pluginId) || typeof entryUrl !== 'string'))) {
      throw Error('invalid scoped Appearance selection')
    }
    if (!root.odkRendererPluginBridge) return []
    const all = await root.odkRendererPluginBridge.list()
    if (!Array.isArray(all) || all.length > 32) throw Error('invalid Appearance startup entries')
    signal?.throwIfAborted()
    const entries = all.filter(entry => entry?.manifest?.id?.startsWith('odk.theme.')
      && (pluginId === undefined || entry.manifest.id === pluginId))
    if (runtime && (entries.length !== 1 || entries[0].manifest.id !== pluginId || entries[0].entryUrl !== entryUrl)) {
      throw Error('Appearance selection changed')
    }
    if (entries.length > 3) throw Error('Appearance entry limit exceeded')
    const previews = entries.map(entry => {
      if (typeof entry.entryUrl !== 'string' || !/^odk-native-plugin:\/\/[a-f0-9]{32}\/[a-zA-Z0-9_./-]+\.js$/.test(entry.entryUrl)) throw Error('invalid native Appearance entry')
      const { entry: filename, ...manifest } = entry.manifest
      const appearance = api.selectAppearancePlugins([manifest]).find(plugin => plugin.manifest.id === manifest.id)?.appearance
      return { manifest: entry.manifest, appearance, create() {} }
    })
    api.selectAppearanceFactories(plugins, previews)
    definitions.clear()
    try {
      for (const entry of entries) {
        active = entry
        activeError = null
        await root.odkRendererDevelopment.loadEntry(entry.entryUrl, { signal, onScript: script => { activeScript = script } })
        signal?.throwIfAborted()
        if (activeError) throw activeError
        if (!definitions.has(entry.manifest.id)) throw Error('Appearance entry did not define its selected factory')
        active = null
      }
      const replacements = [...definitions.values()]
      api.selectAppearanceFactories(plugins, replacements)
      return replacements
    } finally { active = null; activeScript = null; definitions.clear() }
  }

  root.odkAppearanceNative = { define, load }
})(window)
