;
(function (root) {
  'use strict'

  const plugins = new Map()
  const LIFECYCLE = ['install', 'enable', 'mount', 'start', 'pause', 'resume', 'stop', 'unmount', 'disable', 'uninstall']

  root.odkPlugins = {
    register(def) {
      if (!def || typeof def.id !== 'string' || !def.id || typeof def.mount !== 'function' && !def.lifecycle?.mount) {
        throw new Error('plugin requires { id, mount }')
      }
      if (plugins.has(def.id)) throw new Error(`plugin "${def.id}" already registered`)
      const lifecycle = def.lifecycle || {}
      def.lifecycle = Object.fromEntries(LIFECYCLE.map((phase) => [
        phase,
        lifecycle[phase] || (phase === 'mount' ? def.mount : (() => {})),
      ]))
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
    activate(def, el, ctx) {
      const lifecycle = def.lifecycle
      lifecycle.install.call(def, ctx)
      lifecycle.enable.call(def, ctx)
      lifecycle.mount.call(def, el, ctx)
      lifecycle.start.call(def, ctx)
    },
    deactivate(def, el, ctx) {
      const lifecycle = def.lifecycle
      lifecycle.stop.call(def, ctx)
      lifecycle.unmount.call(def, el, ctx)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
