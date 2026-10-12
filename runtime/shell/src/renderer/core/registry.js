;
(function (root) {
  'use strict'

  const plugins = new Map()
  const instances = new WeakMap()
  const developmentStylesheets = new WeakMap()
  const mounted = new Set()
  const releases = new Map()
  const elementReleases = new WeakMap()
  const contexts = new Map()
  const transitionLocks = new Map()
  const queuedTransitions = new Map()
  const placements = new Map()
  const definitionsByFactory = new WeakMap()
  const stylePreparations = new Set()
  let defaults = null
  let managementPending = Promise.resolve()
  const serialManagement = operation => {
    const result = managementPending.then(operation)
    managementPending = result.catch(() => {})
    return result
  }
  const createHost = () => root.odkPluginHost.createPluginHost({
    onError: (id, error) => console.error(`plugin "${id}" failed:`, error),
  })
  let host = createHost()
  let started = false
  let managementOpen = false
  let generation = 0
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
        const callbacks = [...cleanups]
        const pending = callbacks.map(cleanup => {
          try {
            return Promise.resolve(cleanup()).then(() => cleanups.delete(cleanup))
          } catch (error) { return Promise.reject(error) }
        })
        return Promise.allSettled(pending).then(results => {
          const failures = results.filter(result => result.status === 'rejected').map(result => result.reason)
          if (failures.length) throw new AggregateError(failures, 'plugin cleanup failed')
        })
      },
    }
  }

  // Style seam: a plugin may declare one relative css file. The loader injects
  // a single <link data-plugin> after shell.css (hence before themes/*) on
  // first activate and keeps it through disable/enable. Built-in recovery owns
  // a separate stylesheet transition after surface release.
  const stylesheetUrl = def => developmentStylesheets.get(def) || def.css
  const sameStylesheet = (left, right) => left.css === right.css
    && developmentStylesheets.get(left) === developmentStylesheets.get(right)

  function insertPluginStylesheet(doc, link) {
    const shell = doc.querySelector('link[href$="shell.css"]')
    if (shell && shell.parentNode === doc.head && typeof doc.head.insertBefore === 'function') {
      doc.head.insertBefore(link, shell.nextSibling || null)
    } else if (typeof doc.head.appendChild === 'function') {
      doc.head.appendChild(link)
    }
  }

  function ensurePluginStyles(def) {
    if (!def.css) return
    const doc = root.document || (typeof document !== 'undefined' ? document : undefined)
    if (!doc?.head || typeof doc.createElement !== 'function' || typeof doc.querySelector !== 'function') return
    if (doc.querySelector(`link[data-plugin="${def.id}"]`)) return
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = stylesheetUrl(def)
    if (typeof link.setAttribute === 'function') link.setAttribute('data-plugin', def.id)
    else if (link.dataset) link.dataset.plugin = def.id
    insertPluginStylesheet(doc, link)
  }

  async function prepareRecoveryStyles(original, replacement) {
    if (sameStylesheet(original, replacement)) return
    const doc = root.document
    if (!doc?.head || typeof doc.createElement !== 'function' || typeof doc.querySelector !== 'function') return
    const previous = doc.querySelector(`link[data-plugin="${original.id}"]`)
    const previousMedia = previous?.media || ''
    let staged
    if (replacement.css) {
      staged = doc.createElement('link')
      staged.rel = 'stylesheet'
      staged.href = stylesheetUrl(replacement)
      // Load without applying the default's rules to the running external surface.
      staged.media = 'not all'
      await new Promise((resolve, reject) => {
        const finish = error => {
          clearTimeout(timer)
          stylePreparations.delete(cancel)
          staged.onload = staged.onerror = null
          if (error) { staged.remove(); reject(error) }
          else resolve()
        }
        const cancel = () => finish(Error('Renderer stylesheet preparation cancelled by shutdown'))
        const timer = setTimeout(() => finish(Error('built-in Renderer stylesheet timed out')), 2000)
        stylePreparations.add(cancel)
        staged.onload = () => finish()
        staged.onerror = () => finish(Error('built-in Renderer stylesheet unavailable'))
        try { insertPluginStylesheet(doc, staged) } catch (error) { finish(error) }
      })
    }
    const select = selected => {
      const restored = sameStylesheet(selected, replacement)
      if (previous) {
        // Keep the loaded sheet available for synchronous rollback. Disabling
        // a link can make Chromium reload it when it becomes active again.
        previous.media = restored ? 'not all' : previousMedia
        if (restored) previous.removeAttribute('data-plugin')
        else previous.setAttribute('data-plugin', original.id)
      }
      if (staged) {
        staged.media = restored ? '' : 'not all'
        if (restored) staged.setAttribute('data-plugin', original.id)
        else staged.removeAttribute('data-plugin')
      }
    }
    return {
      select,
      finish(selected) {
        select(selected)
        if (sameStylesheet(selected, replacement)) previous?.remove()
        else staged?.remove()
      },
    }
  }

  function callLifecycle(def, phase, ...args) {
    def.__lifecycleTrace ||= []
    def.__lifecycleTrace.push(phase)
    return def.lifecycle[phase].call(def, ...args)
  }

  function hostDefinition(def) {
    const surfacePort = `odk:surface/${def.id}/v1`
    const definition = {
      manifest: {
        ...def.manifest,
        id: def.id,
        name: def.manifest.name || def.name || def.id,
        version: def.manifest.version || '1.0.0',
        kind: def.kind === 'app' ? 'application' : 'surface',
        host: 'electron-renderer',
        provides: [{ interface: surfacePort }, ...(def.manifest.provides || [])],
      },
      async create(context) {
        contexts.set(def.id, context)
        const releaseSurfaces = () => {
          for (const instance of [...mounted]) {
            if (instance.def.id === def.id) deactivate(instance)
          }
          return Promise.all([...releases]
            .filter(([, id]) => id === def.id)
            .map(([release]) => release))
        }
        context.onCleanup(async () => {
          await releaseSurfaces()
          contexts.delete(def.id)
        })
        const instance = await def.create?.(context) || {}
        return {
          ports: { ...instance.ports, [surfacePort]: def },
          start: () => instance.start?.(),
          async stop() {
            await releaseSurfaces()
            await instance.stop?.()
          },
          destroy: () => instance.destroy?.(),
        }
      },
    }
    definitionsByFactory.set(definition.create, def)
    return definition
  }

  function registerHost(target, def) { target.register(hostDefinition(def)) }

  function affectedPlugins(id) {
    const affected = new Set([id])
    const declarations = host.list()
    let changed = true
    while (changed) {
      changed = false
      const provided = new Set(declarations.filter(plugin => affected.has(plugin.manifest.id))
        .flatMap(plugin => plugin.manifest.provides.map(port => port.interface)))
      for (const plugin of declarations) {
        if (!affected.has(plugin.manifest.id) && plugin.manifest.requires.some(port => provided.has(port.interface))) {
          affected.add(plugin.manifest.id)
          changed = true
        }
      }
    }
    return affected
  }

  function restorePlacements(affected) {
    if (!managementOpen) return
    const failures = []
    for (const [el, placement] of placements) {
      const { def, ctx } = placement
      if (!affected.has(def.id) || transitionLocks.has(def.id)) continue
      if (el.isConnected === false) { placements.delete(el); continue }
      const available = host.get(`odk:surface/${def.id}/v1`) === def
      // Retained instances still own the element, including failed release work.
      if (instances.has(el) || elementReleases.has(el)) {
        if (available && placement.failed) failures.push(Error(`retained mount failure: ${def.id}`))
        continue
      }
      try {
        el.replaceChildren?.()
        if (available && !activateSurface(def, el, ctx, true)) throw Error(`mount failed: ${def.id}`)
      } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'renderer surface restoration failed')
  }

  function queueManagement(id, epoch, operation) {
    const affected = affectedPlugins(id)
    refuseActiveApp(affected)
    for (const identity of affected) queuedTransitions.set(identity, (queuedTransitions.get(identity) || 0) + 1)
    return serialManagement(async () => {
      try {
        if (!managementOpen || epoch !== generation) throw Error('renderer runtime is shutting down')
        refuseActiveApp(affected)
        return await operation(affected)
      } finally {
        for (const identity of affected) {
          const remaining = queuedTransitions.get(identity) - 1
          if (remaining) queuedTransitions.set(identity, remaining)
          else queuedTransitions.delete(identity)
        }
      }
    })
  }

  function refuseActiveApp(affected) {
    if ([...mounted].some(instance => instance.def.kind === 'app' && affected.has(instance.def.id))) {
      throw Error('App surface must close before plugin lifecycle changes')
    }
  }

  function lockTransitions(affected) {
    for (const id of affected) transitionLocks.set(id, (transitionLocks.get(id) || 0) + 1)
  }

  function unlockTransitions(affected) {
    for (const id of affected) {
      const remaining = transitionLocks.get(id) - 1
      if (remaining) transitionLocks.set(id, remaining)
      else transitionLocks.delete(id)
    }
  }

  function syncSelectedDefinition(id) {
    const selected = definitionsByFactory.get(host.definition(id).create)
    if (!selected) throw Error('unknown selected Renderer factory')
    plugins.set(id, selected)
    for (const placement of placements.values()) if (placement.def.id === id) {
      if (placement.def !== selected) delete placement.failed
      placement.def = selected
    }
  }

  function composeReplacements(replacements, runtime = false) {
    if (!runtime && (started || mounted.size || releases.size || contexts.size)) throw Error('renderer replacement is permitted only before startup')
    const selected = new Map(plugins)
    const identities = new Set()
    for (const replacement of replacements) {
      validateDefinition(replacement)
      const original = plugins.get(replacement.id)
      if (!original || identities.has(replacement.id)) throw Error(`invalid renderer replacement identity: ${replacement.id}`)
      identities.add(replacement.id)
      const contract = def => ({
        kind: def.kind, slot: def.slot, surface: def.surface || 'display',
        interaction: def.interaction || 'display-only', appId: def.appId || def.id, appKind: def.appKind,
        minCell: def.manifest.minCell,
        ports: (def.manifest.provides || []).map(port => port.interface).sort(),
        requires: (def.manifest.requires || []).map(port => [port.interface, Boolean(port.optional)]).sort((a, b) => a[0].localeCompare(b[0])),
        permissions: [...(def.manifest.permissions || [])].sort(),
      })
      if (JSON.stringify(contract(original)) !== JSON.stringify(contract(replacement))) throw Error(`renderer replacement changes external contract: ${replacement.id}`)
      const lifecycle = replacement.lifecycle || {}
      if (typeof (lifecycle.mount || replacement.mount) !== 'function') throw Error(`plugin "${replacement.id}" requires mount`)
      replacement.lifecycle = Object.fromEntries(LIFECYCLE.map(phase => [phase,
        lifecycle[phase] || replacement[phase] || (() => {}),
      ]))
      selected.set(replacement.id, replacement)
    }
    const candidate = createHost()
    selected.forEach(def => registerHost(candidate, def))
    candidate.validate()
    return { candidate, selected }
  }

  function admitRuntimeReplacements(definitions, { recovery = false } = {}) {
    if (!managementOpen) throw Error('renderer runtime management requires an active startup')
    if (!Array.isArray(definitions)) throw Error('renderer replacements must be an array')
    const admitted = definitions.map(definition => {
      const def = { ...definition, manifest: structuredClone(definition?.manifest),
        ...(definition?.lifecycle ? { lifecycle: { ...definition.lifecycle } } : {}) }
      const stylesheet = developmentStylesheets.get(definition)
      if (stylesheet) developmentStylesheets.set(def, stylesheet)
      return def
    })
    const { candidate } = composeReplacements(admitted, true)
    for (const def of admitted) {
      const previous = plugins.get(def.id)
      if (!recovery && !sameStylesheet(def, previous)) {
        throw Error('runtime replacement changes stylesheet contract')
      }
    }
    return { admitted, candidate }
  }

  async function replaceDefinition(definition, { requireEnabled = false, recovery = false } = {}) {
    const requireAvailable = () => {
      if (requireEnabled && !host.list().find(plugin => plugin.manifest.id === definition.id)?.enabled) {
        throw Error('built-in restoration requires an enabled Renderer surface')
      }
    }
    requireAvailable()
    const epoch = generation
    // Capture and validate before queuing; caller mutation cannot change admission.
    const { admitted: [def] } = admitRuntimeReplacements([definition], { recovery })
    return queueManagement(def.id, epoch, async affected => {
      requireAvailable()
      admitRuntimeReplacements([def], { recovery })
      const original = plugins.get(def.id)
      const styles = recovery ? await prepareRecoveryStyles(original, def) : undefined
      let failure
      try {
        if (!managementOpen || epoch !== generation) throw Error('renderer replacement cancelled by shutdown')
        lockTransitions(affected)
        try { await host.replace(hostDefinition(def)) } catch (error) { failure = error }
        syncSelectedDefinition(def.id)
        styles?.select(plugins.get(def.id))
        unlockTransitions(affected)
        if (!managementOpen || epoch !== generation) throw failure || Error('renderer replacement cancelled by shutdown')
        try { restorePlacements(affected) } catch (error) {
          // Factory activation succeeded but mounting failed. Retained candidate
          // cleanup must finish before the previous definition can return.
          lockTransitions(affected)
          try { await host.replace(hostDefinition(original)) }
          finally {
            syncSelectedDefinition(def.id)
            styles?.select(plugins.get(def.id))
            unlockTransitions(affected)
          }
          restorePlacements(affected)
          throw error
        }
        if (failure) throw failure
        return host.list()
      } finally {
        // A Host refusal may leave either definition selected with retained ownership.
        syncSelectedDefinition(def.id)
        styles?.finish(plugins.get(def.id))
        if (transitionLocks.has(def.id)) unlockTransitions(affected)
      }
    })
  }

  root.odkPlugins = {
    captureDefaults() {
      if (defaults) return
      if (started) throw Error('Renderer defaults must be captured before startup')
      defaults = new Map([...plugins].map(([id, def]) => {
        const captured = { ...def, manifest: structuredClone(def.manifest), lifecycle: { ...def.lifecycle } }
        const stylesheet = developmentStylesheets.get(def)
        if (stylesheet) developmentStylesheets.set(captured, stylesheet)
        return [id, captured]
      }))
    },
    prepareDevelopmentStylesheet(def, url) {
      if (started) throw Error('renderer stylesheet preparation is permitted only before startup')
      validateDefinition(def)
      if (def.manifest.css !== def.css || typeof url !== 'string'
        || !(/^file:\/\/.*\.css$/.test(url) || /^odk-native-plugin:\/\/[a-f0-9]{32}\/.+\.css$/.test(url)))
        throw Error('invalid renderer development stylesheet')
      // This URL comes from authenticated Main discovery. Ordinary css stays relative.
      developmentStylesheets.set(def, url)
    },
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
      registerHost(host, def)
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
    validateReplacements(replacements) {
      if (!Array.isArray(replacements)) throw Error('renderer replacements must be an array')
      return composeReplacements(replacements).candidate.list()
    },
    validateRuntimeReplacements: definitions => admitRuntimeReplacements(definitions).candidate.list(),
    async start({ disabled = [], replacements = [] } = {}) {
      root.odkPlugins.captureDefaults()
      if (!Array.isArray(replacements)) throw Error('renderer replacements must be an array')
      if (replacements.length) {
        const { candidate, selected } = composeReplacements(replacements)
        host = candidate
        plugins.clear()
        selected.forEach((def, id) => plugins.set(id, def))
      }
      const initialStartup = !started
      const epoch = generation
      started = true
      managementOpen = true
      for (const id of disabled) {
        if (epoch !== generation) return host.list()
        if (plugins.has(id)) {
          if (initialStartup) await host.setEnabled(id, false)
          else await root.odkPlugins.setEnabled(id, false)
        }
      }
      if (epoch !== generation) return host.list()
      return host.start()
    },
    async stop() {
      managementOpen = false
      for (const cancel of stylePreparations) cancel()
      placements.clear()
      generation++
      await host.stop()
      // Host-owned surfaces already attempted release. Do not retry a failure
      // inside the same shutdown request; standalone mounts have no factory.
      const standalone = [...mounted].filter(instance => !contexts.has(instance.def.id))
      await Promise.all(standalone.map(deactivate))
      await Promise.all([...releases.keys()])
    },
    replace: definition => replaceDefinition(definition),
    async restoreDefault(id) {
      const original = defaults?.get(id)
      if (!original) throw Error('Renderer surface has no captured built-in default')
      await replaceDefinition(original, { requireEnabled: true, recovery: true })
      const selected = plugins.get(id)
      const current = host.list().find(plugin => plugin.manifest.id === id)
      if (!managementOpen || current?.state !== 'running' || !current.enabled
        || selected.create !== original.create || selected.lifecycle.mount !== original.lifecycle.mount
        || selected.lifecycle.unmount !== original.lifecycle.unmount || root.odkPlugins.hasFailedPlacement(id)) {
        throw Error('built-in Renderer restoration incomplete')
      }
      return { implementation: 'built-in', version: original.manifest.version || '1.0.0', state: 'running' }
    },
    async setEnabled(id, enabled) {
      const epoch = generation
      if (!managementOpen) throw Error('renderer runtime management requires an active startup')
      if (!plugins.has(id)) throw Error(`unknown plugin ${id}`)
      if (typeof enabled !== 'boolean') throw TypeError('enabled must be a boolean')
      return queueManagement(id, epoch, async affected => {
        lockTransitions(affected)
        let result
        try { result = await host.setEnabled(id, enabled) }
        finally { unlockTransitions(affected) }
        restorePlacements(affected)
        return result
      })
    },
    catalog: () => host.list(),
    hasFailedPlacement(id) {
      const affected = affectedPlugins(id)
      return [...placements.values()].some(placement => affected.has(placement.def.id) && placement.failed
        && host.get(`odk:surface/${placement.def.id}/v1`) === placement.def)
    },
    port: (name) => host.get(name),
    activate: (def, el, ctx) => activateSurface(def, el, ctx),
    isActive(def, el) {
      const instance = instances.get(el)
      return Boolean(instance?.def === def && !instance.releaseAttempted && !instance.ctx.signal?.aborted
        && (!started || host.get(`odk:surface/${def.id}/v1`) === def))
    },
    deactivate(def, el, ctx) {
      placements.delete(el)
      const instance = instances.get(el)
      return instance ? deactivate(instance) : elementReleases.get(el)
    },
  }

  function activateSurface(def, el, ctx, restoring = false) {
    if (transitionLocks.has(def.id) || (!restoring && queuedTransitions.has(def.id))) return false
    if (started && host.get(`odk:surface/${def.id}/v1`) !== def) return false
    const context = contexts.get(def.id)
    if (context?.signal.aborted) return false
    if (!context && def.manifest.requires?.length) return false
    if (instances.has(el)) deactivate(instances.get(el))
    if (elementReleases.has(el)) return false
    const scoped = scopedContext({
      ...ctx,
      ...(context ? { signal: context.signal, getPort: context.get, capability: context.capability } : {}),
    })
    ensurePluginStyles(def)
    if (def.kind !== 'app') placements.set(el, { def, ctx })
    const instance = { def, el, ctx: scoped }
    instances.set(el, instance)
    mounted.add(instance)
    try {
      callLifecycle(def, 'mount', el, scoped)
      return true
    } catch (error) {
      const placement = placements.get(el)
      if (placement?.def === def) placement.failed = true
      instance.unmounted = true
      deactivate(instance)
      el?.replaceChildren?.()
      console.error(`plugin "${def.id}" failed to mount:`, error)
      return false
    }
  }


  function deactivate(instance) {
    if (instance.release) return instance.release
    return trackRelease(Promise.resolve().then(async () => {
      const failures = []
      if (!instance.unmounted) {
        try {
          await callLifecycle(instance.def, 'unmount', instance.el, instance.ctx)
          instance.unmounted = true
        } catch (error) { failures.push(error) }
      }
      try { await instance.ctx.cleanup() } catch (error) { failures.push(error) }
      if (failures.length) throw new AggregateError(failures, 'plugin surface release failed')
    }), instance)
  }

  function trackRelease(release, instance) {
    const { def, el } = instance
    instance.release = release
    instance.releaseAttempted = true
    releases.set(release, def.id)
    elementReleases.set(el, release)
    const settled = () => {
      releases.delete(release)
      if (elementReleases.get(el) === release) elementReleases.delete(el)
      instance.release = null
    }
    // Consume failures even when a synchronous mount caller cannot await them.
    // The instance retains its failed work for the next explicit release.
    release.then(() => {
      settled()
      mounted.delete(instance)
      if (instances.get(el) === instance) instances.delete(el)
    }, error => {
      settled()
      console.error(`plugin "${def.id}" failed to release:`, error)
    })
    return release
  }
})(typeof window !== 'undefined' ? window : globalThis)
