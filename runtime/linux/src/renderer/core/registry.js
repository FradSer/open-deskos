;
(function (root) {
  'use strict'

  const plugins = new Map()
  const instances = new WeakMap()
  const LIFECYCLE = ['mount', 'unmount']
  const KINDS = new Set(['tile', 'page', 'status', 'app'])

  function validateCss(def) {
    if (def.css === undefined) return
    const valid = typeof def.css === 'string'
      && def.css.endsWith('.css')
      && !def.css.includes('..')
      && !def.css.startsWith('/')
      && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(def.css)
    if (!valid) throw new Error(`plugin "${def.id}" declares invalid css`)
  }

  function validateDefinition(def) {
    if (!def || typeof def.id !== 'string' || !def.id.startsWith('odk.') || !def.kind || !KINDS.has(def.kind)) {
      throw new Error('plugin requires an Open DeskOS identity and supported kind')
    }
    if (!def.manifest || def.manifest.schemaVersion !== 1) {
      throw new Error(`plugin "${def.id}" requires manifest schema version 1`)
    }
    validateCss(def)
    if (def.kind === 'status' && !['left', 'right'].includes(def.slot)) {
      throw new Error(`status plugin "${def.id}" requires a supported slot`)
    }
    if (def.kind === 'tile' && def.interaction && def.interaction !== 'display-only') {
      throw new Error(`tile "${def.id}" must be display-only`)
    }
    if (def.kind === 'tile' && def.appId) {
      throw new Error(`tile "${def.id}" cannot declare an App continuation`)
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

  // Style seam: a plugin may declare one relative css file. The loader injects
  // a single <link data-plugin> after shell.css (hence before themes/*) on
  // first activate and never removes it: tiles are long-lived and re-adding
  // would flash unstyled content. No-DOM contexts (unit tests) skip silently.
  function ensurePluginStyles(def) {
    if (!def.css) return
    const doc = root.document || (typeof document !== 'undefined' ? document : undefined)
    if (!doc?.head || typeof doc.createElement !== 'function' || typeof doc.querySelector !== 'function') return
    if (doc.querySelector(`link[data-plugin="${def.id}"]`)) return
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = def.css
    if (typeof link.setAttribute === 'function') link.setAttribute('data-plugin', def.id)
    else if (link.dataset) link.dataset.plugin = def.id
    const shell = doc.querySelector('link[href$="shell.css"]')
    if (shell && shell.parentNode === doc.head && typeof doc.head.insertBefore === 'function') {
      doc.head.insertBefore(link, shell.nextSibling || null)
    } else if (typeof doc.head.appendChild === 'function') {
      doc.head.appendChild(link)
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
      ensurePluginStyles(def)
      try {
        callLifecycle(def, 'mount', el, scoped)
        instances.set(el, { def, ctx: scoped })
        return true
      } catch (error) {
        scoped.cleanup()
        el?.replaceChildren?.()
        console.error(`plugin "${def.id}" failed to mount:`, error)
        return false
      }
    },
    deactivate(def, el, ctx) {
      const instance = instances.get(el)
      const scoped = instance?.ctx || ctx
      try {
        callLifecycle(def, 'unmount', el, scoped)
      } catch (error) {
        console.error(`plugin "${def.id}" failed to unmount:`, error)
      } finally {
        scoped.cleanup?.()
        if (el) instances.delete(el)
      }
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
