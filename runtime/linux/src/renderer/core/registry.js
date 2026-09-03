;
(function (root) {
  'use strict'

  const plugins = new Map()
  const instances = new WeakMap()
  const LIFECYCLE = ['mount', 'unmount']
  const KINDS = new Set(['tile', 'page', 'status', 'app'])

  function validateDefinition(def) {
    if (!def || typeof def.id !== 'string' || !def.id.startsWith('odk.') || !def.kind || !KINDS.has(def.kind)) {
      throw new Error('plugin requires an Open DeskOS identity and supported kind')
    }
    if (!def.manifest || def.manifest.schemaVersion !== 1) {
      throw new Error(`plugin "${def.id}" requires manifest schema version 1`)
    }
    if (def.kind === 'status' && !['left', 'right'].includes(def.slot)) {
      throw new Error(`status plugin "${def.id}" requires a supported slot`)
    }
    if (def.kind === 'tile' && def.interaction === 'display-only' && def.appId) {
      throw new Error(`display-only tile "${def.id}" cannot declare appId`)
    }
    if (def.kind === 'tile' && def.interaction === 'open-app' && !def.appId) {
      throw new Error(`open-app tile "${def.id}" requires appId`)
    }
  }

  function scopedContext(ctx) {
    const cleanups = new Set()
    const trackCleanup = (cleanup) => {
      if (typeof cleanup === 'function') cleanups.add(cleanup)
      return cleanup
    }
    return {
      ...ctx,
      onTick: (listener) => trackCleanup(ctx.onTick(listener)),
      trackCleanup,
      cleanup() {
        for (const cleanup of cleanups) cleanup()
        cleanups.clear()
      },
    }
  }

  function callLifecycle(def, phase, ...args) {
    def.__lifecycleTrace ||= []
    def.__lifecycleTrace.push(phase)
    return def.lifecycle[phase].call(def, ...args)
  }

  root.odkPlugins = {
    register(def) {
      validateDefinition(def)
      if (typeof def.mount !== 'function' && !def.lifecycle?.mount) {
        throw new Error(`plugin "${def.id}" requires mount`)
      }
      if (plugins.has(def.id)) throw new Error(`plugin "${def.id}" already registered`)
      const lifecycle = def.lifecycle || {}
      def.lifecycle = Object.fromEntries(LIFECYCLE.map((phase) => [
        phase,
        lifecycle[phase] || def[phase] || (phase === 'mount' ? (def.mount || (() => {})) : (() => {})),
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
      const scoped = scopedContext(ctx)
      try {
        callLifecycle(def, 'mount', el, scoped)
        instances.set(el, { def, ctx: scoped })
      } catch (error) {
        scoped.cleanup()
        throw error
      }
    },
    deactivate(def, el, ctx) {
      const instance = instances.get(el)
      const scoped = instance?.ctx || ctx
      try {
        callLifecycle(def, 'unmount', el, scoped)
      } finally {
        scoped.cleanup?.()
        if (el) instances.delete(el)
      }
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
