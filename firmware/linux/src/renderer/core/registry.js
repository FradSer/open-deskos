;
(function (root) {
  'use strict'

  const plugins = new Map()
  const instances = new WeakMap()
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
    activate(def, el, ctx) {
      const lifecycle = def.lifecycle
      const scoped = scopedContext(ctx)
      callLifecycle(def, 'install', scoped)
      callLifecycle(def, 'enable', scoped)
      callLifecycle(def, 'mount', el, scoped)
      callLifecycle(def, 'start', scoped)
      instances.set(el, { def, ctx: scoped })
    },
    deactivate(def, el, ctx) {
      const lifecycle = def.lifecycle
      const instance = instances.get(el)
      const scoped = instance?.ctx || ctx
      callLifecycle(def, 'stop', scoped)
      callLifecycle(def, 'unmount', el, scoped)
      scoped.cleanup?.()
      instances.delete(el)
    },
    disable(def, el, ctx) {
      const instance = el && instances.get(el)
      callLifecycle(def, 'disable', instance?.ctx || ctx)
    },
    uninstall(def, el, ctx) {
      const instance = el && instances.get(el)
      callLifecycle(def, 'uninstall', instance?.ctx || ctx)
    },
    retire(def, el, ctx) {
      if (el) root.odkPlugins.deactivate(def, el, ctx)
      else callLifecycle(def, 'stop', ctx)
      root.odkPlugins.disable(def, el, ctx)
      root.odkPlugins.uninstall(def, el, ctx)
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
