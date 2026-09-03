;
(function (root) {
  'use strict'

  const plugins = new Map()
  const instances = new WeakMap()
  const enabled = new Set()
  const LIFECYCLE = ['install', 'enable', 'mount', 'start', 'pause', 'resume', 'stop', 'unmount', 'disable', 'uninstall']
  const KINDS = new Set([
    'tile', 'page', 'status', 'peek', 'app',
    'surface', 'application', 'service', 'transport', 'device-driver', 'processor', 'protocol', 'integration', 'system', 'theme',
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

  function scopedContext(ctx, def = null) {
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

    if (def?.id) {
      scoped.callBackend = (action, payload) => {
        if (typeof root.odkPlatform?.callPluginRpc !== 'function') {
          return Promise.reject(new Error('backend-unavailable'))
        }
        return root.odkPlatform.callPluginRpc({
          pluginId: def.id,
          action,
          payload,
        })
      }
    }

    for (const key of SERVICE_KEYS) {
      if (ctx[key]?.subscribe) {
        scoped[key] = {
          ...ctx[key],
          subscribe: (listener) => track(ctx[key].subscribe(listener)),
        }
      }
    }

    const services = ctx.services || root.odkServices
    if (services) {
      scoped.services = {
        get: (serviceId) => {
          const shortKey = serviceId.replace(/^odk\.service\./, '')
          if (scoped[shortKey]) return scoped[shortKey]
          if (scoped[serviceId]) return scoped[serviceId]
          const svc = services.get?.(serviceId) || ctx[serviceId] || ctx[shortKey]
          if (svc && typeof svc.subscribe === 'function') {
            return {
              ...svc,
              subscribe: (listener) => track(svc.subscribe(listener)),
            }
          }
          return svc
        },
        has: (serviceId) => Boolean(services.has ? services.has(serviceId) : services.get?.(serviceId)),
        list: () => (services.list ? services.list() : []),
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
        lifecycle[phase] || def[phase] || (phase === 'mount' ? (def.mount || (() => {})) : (() => {})),
      ]))
      plugins.set(def.id, def)
      if (def.kind === 'theme' && root.odkTheme?.registerTheme) {
        root.odkTheme.registerTheme(def)
      }
      if (def.kind === 'service') {
        const getExport = () => (typeof def.export === 'function' ? def.export() : (def.exports || def))
        if (root.odkServices?.registerService) {
          root.odkServices.registerService(def.id, getExport())
        }
        try {
          const sCtx = root.odkServices || {}
          root.odkPlugins.activate(def, def, sCtx)
          if (root.odkServices?.registerService) {
            root.odkServices.registerService(def.id, getExport())
          }
        } catch {}
      }
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
      const scoped = scopedContext(ctx, def)
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
      const targetEl = el || (def.kind === 'service' ? def : null)
      const instance = instances.get(targetEl)
      const scoped = instance?.ctx || ctx
      let failure = null
      try {
        callLifecycle(def, 'stop', scoped)
      } catch (error) {
        failure = error
      }
      try {
        callLifecycle(def, 'unmount', targetEl, scoped)
      } catch (error) {
        failure ||= error
      } finally {
        if (def.kind === 'service') {
          root.odkServices?.unregisterService?.(def.id)
        }
        scoped.cleanup?.()
        if (targetEl) instances.delete(targetEl)
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
