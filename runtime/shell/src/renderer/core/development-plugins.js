;(function (root) {
  'use strict'

  let active = null
  let activeError = null
  let activeScript = null
  let activeDesktop = false
  const definitions = new Map()
  let pending = Promise.resolve()
  const define = (definition, desktop) => {
    if (!activeScript || root.document.currentScript !== activeScript) {
      throw Error('Renderer definition requires its executing selected script')
    }
    if (!active || activeDesktop !== desktop || definition?.id !== active.manifest.id || definitions.has(definition.id)
      || (desktop && typeof definition.create !== 'function')) {
      activeError = Error('renderer entry must define its selected identity once')
      throw activeError
    }
    const selected = desktop ? { manifest: active.manifest, create: definition.create }
      : { ...definition, ...(active.cssUrl ? { css: active.manifest.css } : {}), manifest: declaration(active.manifest) }
    if (!desktop && active.cssUrl) root.odkPlugins.prepareDevelopmentStylesheet(selected, active.cssUrl)
    definitions.set(definition.id, selected)
  }
  const declaration = manifest => ({ ...manifest,
    provides: manifest.provides.filter(port => port.interface !== `odk:surface/${manifest.id}/v1`),
  })
  const preview = (entry, runtime) => ({ id: entry.manifest.id, kind: entry.manifest.surfaceKind,
    slot: entry.manifest.slot, surface: entry.manifest.surface, interaction: entry.manifest.interaction,
    appId: entry.manifest.appId, appKind: entry.manifest.appKind,
    // Without package CSS, preflight must preserve the running Shell stylesheet.
    // The actual entry still has to satisfy the same runtime stylesheet checks.
    css: entry.manifest.css ?? (runtime ? root.odkPlugins.get(entry.manifest.id)?.css : undefined),
    manifest: declaration(entry.manifest), mount() {},
  })

  function loadEntry(entryUrl, { signal, onScript } = {}) {
    return new Promise((resolve, reject) => {
      const script = root.document.createElement('script')
      let settled = false
      let executionError = null
      const onError = event => {
        if (event.filename === entryUrl) executionError = Error('renderer development script failed')
      }
      const onAbort = () => finish(Error('trusted Renderer entry cancelled'))
      const finish = error => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        root.removeEventListener('error', onError)
        signal?.removeEventListener('abort', onAbort)
        script.remove()
        if (activeScript === script) activeScript = null
        if (error) reject(error)
        else resolve()
      }
      const timer = setTimeout(() => finish(Error('renderer development script timed out')), 2000)
      root.addEventListener('error', onError)
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) { onAbort(); return }
      if (entryUrl.startsWith('odk-native-plugin:')) script.crossOrigin = 'anonymous'
      script.src = entryUrl
      if (active?.entryUrl === entryUrl) activeScript = script
      script.onload = () => finish(executionError)
      script.onerror = () => finish(Error('renderer development script unavailable'))
      try { onScript?.(script); root.document.head.appendChild(script) } catch (error) { finish(error) }
    })
  }

  function load({ runtime = false, pluginId, entryUrl, signal } = {}) {
    if (typeof runtime !== 'boolean') return Promise.reject(TypeError('runtime must be a boolean'))
    if ((pluginId !== undefined || entryUrl !== undefined) && (!runtime || typeof pluginId !== 'string'
      || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(pluginId) || typeof entryUrl !== 'string')) {
      return Promise.reject(TypeError('invalid scoped Renderer selection'))
    }
    return enqueue(runtime, { pluginId, entryUrl, signal })
  }

  function enqueue(runtime, options, desktop = false) {
    const result = pending.then(() => loadSelected(runtime, options, desktop))
    pending = result.catch(() => {})
    return result
  }

  async function loadSelected(runtime, { pluginId, entryUrl, signal }, desktop) {
    signal?.throwIfAborted()
    if (!root.odkRendererPluginBridge) return []
    // Discovery is read-only. Consume late replies without keeping cancellation
    // dependent on Main returning them.
    const all = await new Promise((resolve, reject) => {
      const cleanup = () => signal?.removeEventListener('abort', onAbort)
      const onAbort = () => { cleanup(); reject(signal.reason || Error('Renderer discovery aborted')) }
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) { onAbort(); return }
      Promise.resolve().then(() => { signal?.throwIfAborted(); return root.odkRendererPluginBridge.list() }).then(
        value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) },
      )
    })
    if (!Array.isArray(all) || all.length > 32) throw Error('invalid renderer development entries')
    signal?.throwIfAborted()
    const entries = all.filter(entry => desktop ? entry?.manifest?.id === root.odkUserAppDesktopPlugins.manifest.id
      : !entry?.manifest?.id?.startsWith('odk.theme.')
      && entry?.manifest?.id !== 'odk.system.user-app-desktop'
      && (pluginId === undefined || entry?.manifest?.id === pluginId))
    if (pluginId !== undefined && (entries.length !== 1 || entries[0].entryUrl !== entryUrl)) {
      throw Error('Renderer selection changed')
    }
    if (!Array.isArray(entries) || entries.length > 32) throw Error('invalid renderer development entries')
    if (desktop && entries.length > 1) throw Error('Duplicate desktop startup entries')
    if (!entries.length) return []
    for (const entry of entries) {
      if (desktop) {
        root.odkUserAppDesktopPlugins.validate(entry.manifest)
        if (entry.cssUrl !== undefined || typeof entry.entryUrl !== 'string'
          || !(entry.entryUrl.startsWith('file:') || /^odk-native-plugin:\/\/[a-f0-9]{32}\/[a-zA-Z0-9_./-]+\.js$/.test(entry.entryUrl))) throw Error('Invalid desktop browser entry')
      }
      if (entry?.manifest?.host !== 'electron-renderer' || typeof entry.entryUrl !== 'string'
        || !(entry.entryUrl.startsWith('file:') || /^odk-native-plugin:\/\/[a-f0-9]{32}\/.+\.js$/.test(entry.entryUrl))) throw Error('invalid renderer development entry')
      if ((entry.manifest.css !== undefined || entry.cssUrl !== undefined)
        && (typeof entry.manifest.css !== 'string' || typeof entry.cssUrl !== 'string'
          || !(entry.cssUrl.startsWith('file:') || /^odk-native-plugin:\/\/[a-f0-9]{32}\/.+\.css$/.test(entry.cssUrl))))
        throw Error('invalid renderer development stylesheet')
    }
    if (runtime && entries.some(entry => entry.cssUrl !== undefined || entry.manifest.css !== undefined)) {
      throw Error('runtime Renderer stylesheet loading is not supported')
    }
    const validate = definitions => {
      if (desktop) {
        for (const definition of definitions) {
          root.odkUserAppDesktopPlugins.validate(definition.manifest)
          if (typeof definition.create !== 'function') throw Error('Desktop entry requires a factory')
        }
      } else if (runtime) root.odkPlugins.validateRuntimeReplacements(definitions)
      else root.odkPlugins.validateReplacements(definitions)
    }
    validate(entries.map(entry => desktop ? { manifest: entry.manifest, create() {} } : preview(entry, runtime)))
    // Load declared CSS without applying it. Rejected entries must leave the default UI intact.
    for (const entry of entries) {
      if (entry.cssUrl === undefined) continue
      await new Promise((resolve, reject) => {
        const link = root.document.createElement('link')
        let settled = false
        const finish = error => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          link.remove()
          if (error) reject(error)
          else resolve()
        }
        const timer = setTimeout(() => finish(Error('renderer development stylesheet timed out')), 2000)
        link.rel = 'stylesheet'
        link.media = 'not all'
        link.href = entry.cssUrl
        link.onload = () => finish()
        link.onerror = () => finish(Error('renderer development stylesheet unavailable'))
        root.document.head.appendChild(link)
      })
    }
    definitions.clear()
    try {
      for (const entry of entries) {
        active = entry
        activeDesktop = desktop
        activeError = null
        signal?.throwIfAborted()
        await loadEntry(entry.entryUrl, { signal })
        signal?.throwIfAborted()
        if (activeError) throw activeError
        if (!definitions.has(entry.manifest.id)) throw Error('renderer development entry did not define its replacement')
        active = null
      }
      const replacements = [...definitions.values()]
      validate(replacements)
      return replacements
    } finally { active = null; activeDesktop = false; definitions.clear() }
  }

  root.odkRendererDevelopment = { define: definition => define(definition, false), load, loadEntry }
  // Preserve the desktop browser entry contract with the same loading session.
  root.odkUserAppDesktopLoading = { define: definition => define(definition, true), load: ({ signal } = {}) => enqueue(false, { signal }, true) }
})(window)
