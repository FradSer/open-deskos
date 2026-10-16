;
(function (root) {
  'use strict'

  const key = 'odk.theme'
  const html = document.documentElement
  const api = root.odkAppearancePlugins
  let replacements = []
  try {
    const selection = root.location?.search ? new URLSearchParams(root.location.search).get('appearanceReplacements') : null
    if (selection) {
      if (selection.length > 49152) throw Error('appearance selection limit exceeded')
      replacements = JSON.parse(selection)
    }
    api.selectAppearancePlugins(replacements)
  } catch (error) {
    console.error(`appearance selection rejected: ${error.message}`)
    replacements = []
  }
  let plugins = api.selectAppearancePlugins(replacements)
  const defaults = plugins
  try {
    plugins = api.selectAppearanceFactories(plugins, root.odkAppearanceFactoryReplacements || [])
  } catch (error) {
    console.error(`appearance factory selection rejected: ${error.message}`)
  }
  const themes = new Set(plugins.map(plugin => plugin.appearance.theme))
  const disabled = root.location?.search
    ? (new URLSearchParams(root.location.search).get('disabledPlugins') || '').split(/[\s,]+/).filter(Boolean)
    : []
  let runtime = api.createAppearanceHost({ plugins, disabled, defaults })
  let stopping = false
  const loading = new AbortController()
  let ready = false
  let requested
  const activations = new Map()
  const appearanceSheets = new Map()
  function ensureStyles(appearance) {
    const tokens = plugins.find(plugin => plugin.appearance.theme === appearance?.theme)?.shellTokens
    if (tokens && !appearanceSheets.has(appearance.theme)) {
      const sheet = new CSSStyleSheet()
      sheet.replaceSync(`html[data-theme="${appearance.theme}"]{${Object.entries(tokens).map(([key, value]) => `${key}:${value}`).join(';')}}`)
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      appearanceSheets.set(appearance.theme, sheet)
    }
    if (!appearance?.css || !document.head || document.querySelector(`link[href="${appearance.css}"]`)) return
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = appearance.css
    link.dataset.plugin = `odk.theme.${appearance.theme}`
    document.head.appendChild(link)
  }
  function render(value, persist = true) {
    const appearance = ready ? runtime.resolve(value) : runtime.preview(value)
    ensureStyles(appearance)
    const theme = appearance?.theme || api.DEFAULT_THEME
    html.dataset.theme = theme
    const glassSetup = root.odkLiquidGlassAppearance?.setActive(theme === 'liquid-glass')
    glassSetup?.catch(error => console.error(`Liquid Glass setup failed: ${error.message}`))
    try {
      if (persist) root.localStorage.setItem(key, themes.has(value) ? value : theme)
    } catch {
      // Preferences may be unavailable; appearance still works in this session.
    }
    return glassSetup || Promise.resolve()
  }
  function set(value) { requested = value; return render(value) }

  let saved = api.SHELL_DEFAULT_THEME
  try {
    const item = root.localStorage.getItem(key)
    if (item) saved = item
  } catch {
    // Keep the default when browser storage is unavailable.
  }
  set(saved)
  function updateVisibility() {
    html.dataset.themePaused = String(document.hidden)
  }
  document.addEventListener('visibilitychange', updateVisibility)
  updateVisibility()
  const startup = (async () => {
    if (root.odkAppearanceNative && root.odkRendererPluginBridge) {
      try {
        const native = await root.odkAppearanceNative.load(plugins, { signal: loading.signal })
        if (stopping) return
        if (native.length) {
          plugins = api.selectAppearanceFactories(plugins, native)
          runtime = api.createAppearanceHost({ plugins, disabled, defaults })
        }
      } catch (error) {
        if (!stopping) console.error(`native Appearance selection rejected: ${error.message}`)
      }
    }
    if (stopping) return
    await runtime.start()
    if (stopping) return
    ready = true
    set(requested)
  })().catch(error => console.error(`appearance plugins failed: ${error.message}`))
  root.odkTheme = {
    set, get: () => html.dataset.theme,
    ready: startup,
    catalog: () => runtime.list(),
    async setEnabled(id, enabled) {
      await startup
      if (stopping) throw Error('Appearance runtime is shutting down')
      if (enabled === false) for (const operation of activations.get(id) || []) operation.abort()
      await runtime.setEnabled(id, enabled)
      if (stopping) throw Error('Appearance runtime is shutting down')
      set(requested)
    },
    async activate(request, { signal } = {}) {
      await startup
      const requireAvailable = (operationSignal = signal) => {
        if (stopping || operationSignal?.aborted) throw Error('Appearance activation cancelled')
        const selected = runtime.list().find(plugin => plugin.manifest.id === request.pluginId)
        if (!selected?.enabled || selected.state !== 'running') throw Error('Appearance activation requires an enabled running factory')
      }
      requireAvailable()
      const operation = new AbortController()
      if (!activations.has(request.pluginId)) activations.set(request.pluginId, new Set())
      const owned = activations.get(request.pluginId)
      owned.add(operation)
      const cancel = () => operation.abort()
      const signals = [loading.signal, signal].filter(Boolean)
      for (const source of signals) {
        source.addEventListener('abort', cancel, { once: true })
        if (source.aborted) cancel()
      }
      try {
        const selected = await root.odkAppearanceNative.load(plugins, { runtime: true, pluginId: request.pluginId,
          entryUrl: request.entryUrl, signal: operation.signal })
        requireAvailable(operation.signal)
        if (selected.length !== 1 || selected[0].manifest.version !== request.version) throw Error('Appearance selected version changed')
        await runtime.replace(selected[0], { signal: operation.signal })
        requireAvailable(operation.signal)
        render(requested, false)
      } finally {
        for (const source of signals) source.removeEventListener('abort', cancel)
        owned.delete(operation)
        if (!owned.size) activations.delete(request.pluginId)
      }
    },
    async restoreDefault(id) {
      await startup
      if (stopping) throw Error('Appearance runtime is shutting down')
      const result = await runtime.restoreDefault(id)
      if (stopping) throw Error('Appearance runtime is shutting down')
      render(requested, false)
      return result
    },
  }
  root.addEventListener?.('pagehide', event => {
    if (!event.persisted) {
      stopping = true
      loading.abort()
      void runtime.stop().catch(error => console.error(`appearance plugins stop failed: ${error.message}`))
    }
  })
})(window)
