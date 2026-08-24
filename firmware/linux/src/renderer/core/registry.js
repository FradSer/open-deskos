;
(function (root) {
  'use strict'

  /*
   * Plugin registry: every visual element (page or tile) registers here.
   * Shell core composes the desktop from these definitions plus
   * config/desktop_layout.js — adding a feature means adding a plugin file,
   * never editing core.
   */
  const plugins = new Map()

  root.odkPlugins = {
    register(def) {
      if (!def || typeof def.id !== 'string' || !def.id || typeof def.mount !== 'function') {
        throw new Error('plugin requires { id, mount }')
      }
      if (plugins.has(def.id)) throw new Error(`plugin "${def.id}" already registered`)
      plugins.set(def.id, def)
    },
    has(id) {
      return plugins.has(id)
    },
    get(id) {
      const plugin = plugins.get(id)
      if (!plugin) throw new Error(`unknown plugin "${id}"`)
      return plugin
    },
    ids() {
      return [...plugins.keys()]
    },
    byKind(kind) {
      return [...plugins.values()].filter((def) => def.kind === kind)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
