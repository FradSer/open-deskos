;
(function (root) {
  'use strict'

  const plugins = new Map()
  const instances = new WeakMap()
  const enabled = new Set()
  const LIFECYCLE = ['install', 'enable', 'mount', 'start', 'pause', 'resume', 'stop', 'unmount', 'disable', 'uninstall']

  function scopedContext(ctx) {
    const cleanups = new Set()
    const track = (cleanup) => {
      if (typeof cleanup === 'function') cleanups.add(cleanup)
      return cleanup
    }
    const connection = ctx.connection
      ? {
          ...ctx.connection,
          subscribe: (listener) => track(ctx.connection.subscribe(listener)),
          subscribeBridge: (listener) => track(ctx.connection.subscribeBridge(listener)),
        }
      : ctx.connection
    return {
      ...ctx,
      connection,
      onTick: (listener) => track(ctx.onTick(listener)),
      trackCleanup: track,
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
