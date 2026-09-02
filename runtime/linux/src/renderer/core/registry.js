;
(function (root) {
  'use strict'

  const plugins = new Map()
  const instances = new WeakMap()
  const enabled = new Set()
  const LIFECYCLE = ['install', 'enable', 'mount', 'start', 'pause', 'resume', 'stop', 'unmount', 'disable', 'uninstall']
  const KINDS = new Set([
    'tile', 'page', 'status', 'peek', 'app',
    'surface', 'application', 'service', 'transport', 'device-driver', 'processor', 'protocol', 'integration', 'system',
  ])

  const UI_KINDS = new Set(['tile', 'page', 'status', 'peek', 'surface', 'application'])

  const MANIFEST_ARRAY_FIELDS = ['provides', 'requires', 'permissions']
  const SERVICE_KEYS = ['connection', 'remoteLink', 'subscription', 'faceAgent']

  function validateDefinition(def) {
    if (!def || typeof def.id !== 'string' || !def.id.startsWith('odk.') || !def.kind || !KINDS.has(def.kind)) {
      throw new Error('plugin requires an Open DeskOS identity and supported kind')
    }
    if (!def.manifest || def.manifest.schemaVersion !== 1) {
      throw new Error(`plugin "${def.id}" requires manifest schema version 1`)
    }
    for (const field of MANIFEST_ARRAY_FIELDS) {
      if (def.manifest[field] !== undefined && !Array.isArray(def.manifest[field])) {
        throw new Error(`plugin "${def.id}" manifest.${field} must be an array`)
      }
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
    const track = (cleanup) => {
      if (typeof cleanup === 'function') cleanups.add(cleanup)
      return cleanup
    }

    const scoped = {
      ...ctx,
      onTick: (listener) => track(ctx.onTick(listener)),
      trackCleanup: track,
      cleanup() {
        for (const cleanup of cleanups) cleanup()
        cleanups.clear()
      },
    }

    for (const key of SERVICE_KEYS) {
      if (ctx[key]?.subscribe) {
        scoped[key] = {
          ...ctx[key],
          subscribe: (listener) => track(ctx[key].subscribe(listener)),
        }
      }
    }

    return scoped
  }

  function callLifecycle(def, phase, ...args) {
    def.__lifecycleTrace ||= []
    def.__lifecycleTrace.push(phase)
    return def.lifecycle[phase].call(def, ...args)
  }

  root.odkPlugins = {
    register(def) {
      validateDefinition(def)
      const isUiPlugin = UI_KINDS.has(def.kind)
      if (isUiPlugin && typeof def.mount !== 'function' && !def.lifecycle?.mount) {
        throw new Error(`plugin "${def.id}" requires mount`)
      }
      if (plugins.has(def.id)) throw new Error(`plugin "${def.id}" already registered`)
      const lifecycle = def.lifecycle || {}
      def.lifecycle = Object.fromEntries(LIFECYCLE.map((phase) => [
        phase,
        lifecycle[phase] || (phase === 'mount' ? (def.mount || (() => {})) : (() => {})),
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
    lifecyclePhases() {
      return [...LIFECYCLE]
    },
    supportedKinds() {
      return [...KINDS]
    },
    byKind(kind) {
      return [...plugins.values()].filter((def) => def.kind === kind)
    },
    isEnabled(id) {
      return enabled.has(id)
    },
    activate(def, el, ctx) {
      const scoped = scopedContext(ctx)
      let mountAttempted = false
      try {
        if (!enabled.has(def.id)) {
          callLifecycle(def, 'install', scoped)
          callLifecycle(def, 'enable', scoped)
          enabled.add(def.id)
        }
        mountAttempted = true
        callLifecycle(def, 'mount', el, scoped)
        callLifecycle(def, 'start', scoped)
        instances.set(el, { def, ctx: scoped })
      } catch (error) {
        if (mountAttempted) {
          try { callLifecycle(def, 'unmount', el, scoped) } catch {}
        }
        scoped.cleanup()
        throw error
      }
    },
    deactivate(def, el, ctx) {
      const instance = instances.get(el)
      const scoped = instance?.ctx || ctx
      let failure = null
      try {
        callLifecycle(def, 'stop', scoped)
      } catch (error) {
        failure = error
      }
      try {
        callLifecycle(def, 'unmount', el, scoped)
      } catch (error) {
        failure ||= error
      } finally {
        scoped.cleanup?.()
        instances.delete(el)
      }
      if (failure) throw failure
    },
    retire(def, el, ctx) {
      if (el) root.odkPlugins.deactivate(def, el, ctx)
      if (!enabled.has(def.id)) return
      let failure = null
      try {
        callLifecycle(def, 'disable', ctx)
      } catch (error) {
        failure = error
      } finally {
        try {
          callLifecycle(def, 'uninstall', ctx)
        } catch (error) {
          failure ||= error
        }
        enabled.delete(def.id)
      }
      if (failure) throw failure
    },
    unregister(id, ctx) {
      const def = root.odkPlugins.get(id)
      root.odkPlugins.retire(def, null, ctx)
      plugins.delete(id)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
