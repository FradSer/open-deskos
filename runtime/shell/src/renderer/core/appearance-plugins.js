;(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../../plugin-host'))
  else root.odkAppearancePlugins = factory(root.odkPluginHost)
})(typeof window !== 'undefined' ? window : globalThis, function (hostApi) {
  'use strict'
  const { createPluginHost, validatePluginManifest } = hostApi

  const FONTS = {
    'zpix': { file: 'renderer/fonts/zpix.woff2', contentType: 'font/woff2', family: 'Zpix', weight: 400, format: 'woff2' },
    'montserrat-bold': { file: 'renderer/fonts/Montserrat-Bold.ttf', contentType: 'font/ttf', family: 'Montserrat', weight: 700, format: 'truetype' },
    'noto-sans-sc': { file: 'renderer/fonts/NotoSansSC-Regular.ttf', contentType: 'font/ttf', family: 'Noto Sans SC', weight: 400, format: 'truetype' },
  }

  const SHARED_TOKENS = {
    '--odk-bg': '#000000',
    '--odk-surface': '#171717',
    '--odk-elevated': '#1f1f1f',
    '--odk-button': '#383838',
    '--odk-stroke': '#383838',
    '--odk-stroke-focus': '#b5b5b5',
    '--odk-primary': '#ffffff',
    '--odk-secondary': '#706f70',
    '--odk-secondary-strong': '#b5b5b5',
    '--odk-accent-red': '#eb5757',
    '--odk-accent-green': '#34c759',
    '--odk-accent-blue': '#025bc2',
    '--odk-radius-card': '36px',
    '--odk-radius-pill': '999px',
    '--odk-status-control-h': '44px',
    '--odk-space-1': '4px',
    '--odk-space-2': '8px',
    '--odk-space-3': '16px',
    '--odk-space-4': '24px',
    '--odk-ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
  }

  // The Shell derives its text roles from the grid cell; a package frame *is* a cell,
  // so the same ratios are expressed against the viewport the package is given.
  const CELL_TOKENS = {
    '--odk-cell': '100cqi',
    '--odk-text-label': 'clamp(12px, calc(var(--odk-cell) * 0.05), 16px)',
    '--odk-text-body': 'clamp(16px, calc(var(--odk-cell) * 0.06), 20px)',
    '--odk-text-heading': 'clamp(24px, calc(var(--odk-cell) * 0.1), 36px)',
    '--odk-widget-inset': 'clamp(16px, calc(var(--odk-cell) * 0.08), 28px)',
  }

  const THEME_RULES = {
    instrument: {
      tokens: { ...SHARED_TOKENS, ...CELL_TOKENS, '--odk-font': '"Noto Sans SC", "Montserrat", "Zpix", sans-serif' },
      faces: ['noto-sans-sc', 'montserrat-bold', 'zpix'],
    },
    pixel: {
      tokens: {
        ...SHARED_TOKENS,
        ...CELL_TOKENS,
        '--odk-radius-card': '0px',
        '--odk-radius-pill': '0px',
        '--odk-page-marker-active': 'var(--odk-accent-green)',
        '--odk-font': '"Zpix", monospace',
      },
      faces: ['zpix'],
      extra: 'image-rendering:pixelated;',
    },
    // Border Beam keeps Instrument neutrals and type; only built-in surfaces get the
    // optional perimeter, which a package frame cannot have.
    'border-beam': {
      tokens: { ...SHARED_TOKENS, ...CELL_TOKENS, '--odk-font': '"Noto Sans SC", "Montserrat", "Zpix", sans-serif' },
      faces: ['noto-sans-sc', 'montserrat-bold', 'zpix'],
    },
    'liquid-glass': {
      tokens: {
        ...SHARED_TOKENS,
        ...CELL_TOKENS,
        '--odk-bg': '#080b11',
        '--odk-surface': '#131a25',
        '--odk-elevated': '#1b2635',
        '--odk-button': '#2c3849',
        '--odk-stroke': '#4d5f75',
        '--odk-stroke-focus': '#e4edf8',
        '--odk-primary': '#f3f7fc',
        '--odk-secondary': '#a6b3c3',
        '--odk-secondary-strong': '#d4deea',
        '--odk-radius-card': '32px',
        '--odk-font': '"Noto Sans SC", "Montserrat", "Zpix", sans-serif',
      },
      faces: ['noto-sans-sc', 'montserrat-bold', 'zpix'],
    },
  }


  const DEFAULT_THEME = 'instrument'
  const SHELL_DEFAULT_THEME = 'pixel'
  const LOCAL_CSS = /^themes\/[a-z][a-z0-9-]*\.css$/

  function createAppearancePlugin({ theme, name, css, tokens = {}, faces = [], extra = '' }) {
    if (typeof theme !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(theme)
      || typeof name !== 'string' || !name.trim() || name.length > 128
      || (css !== undefined && !LOCAL_CSS.test(css))
      || !Array.isArray(faces) || new Set(faces).size !== faces.length || faces.some(face => !Object.hasOwn(FONTS, face))
      || !tokens || typeof tokens !== 'object' || Array.isArray(tokens)
      || Object.entries(tokens).some(([key, value]) => !/^--odk-[a-z0-9-]+$/.test(key) || typeof value !== 'string'
        || !value || value.length > 256 || /[<>&;{}@\\\x00-\x1f]|url\s*\(|expression\s*\(/i.test(value))
      || !['', 'image-rendering:pixelated;'].includes(extra)) throw Error('invalid appearance declaration')
    const appearance = { theme, name, ...(css ? { css } : {}), tokens: { ...SHARED_TOKENS, ...CELL_TOKENS, ...tokens, ...(!Object.hasOwn(tokens, '--odk-font') ? { '--odk-font': THEME_RULES.instrument.tokens['--odk-font'] } : {}) }, faces: [...faces], extra }
    const declared = structuredClone(appearance)
    const port = `odk:theme/${theme}/v1`
    return {
      manifest: { schemaVersion: 1, id: `odk.theme.${theme}`, name, version: '1.0.0', kind: 'surface', host: 'electron-renderer',
        provides: [{ interface: port }], requires: [], permissions: [] },
      appearance,
      create: () => ({ ports: { [port]: structuredClone(declared) } }),
    }
  }

  function createAppearancePlugins() {
    return Object.entries(THEME_RULES).map(([theme, rule]) => createAppearancePlugin({
      theme, name: { instrument: 'Instrument', pixel: 'Pixel', 'border-beam': 'Border Beam', 'liquid-glass': 'Liquid Glass' }[theme],
      ...(theme === 'instrument' ? {} : { css: `themes/${theme}.css` }), ...rule,
    }))
  }

  function validateAppearanceReplacement(raw) {
    const manifest = validatePluginManifest(raw)
    const allowed = ['schemaVersion', '$schema', 'id', 'name', 'version', 'kind', 'host', 'provides', 'requires', 'permissions', 'appearance']
    const value = manifest.appearance
    if (Object.keys(manifest).some(key => !allowed.includes(key)) || !value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).some(key => !['theme', 'name', 'css', 'tokens', 'faces', 'extra'].includes(key))) throw Error('invalid appearance replacement')
    const original = createAppearancePlugins().find(plugin => plugin.manifest.id === manifest.id)
    if (!original || manifest.host !== original.manifest.host || manifest.kind !== original.manifest.kind
      || JSON.stringify(manifest.provides) !== JSON.stringify(original.manifest.provides)
      || manifest.requires.length || manifest.permissions.length
      || value.theme !== original.appearance.theme || value.css !== original.appearance.css
      || JSON.stringify(value.faces) !== JSON.stringify(original.appearance.faces) || (value.extra || '') !== original.appearance.extra
      || !value.tokens || typeof value.tokens !== 'object' || Array.isArray(value.tokens)
      || Object.entries(value.tokens).some(([key, color]) => !Object.hasOwn(SHARED_TOKENS, key) || !SHARED_TOKENS[key].startsWith('#')
        || typeof color !== 'string' || !/^#(?:[a-f0-9]{3}|[a-f0-9]{4}|[a-f0-9]{6}|[a-f0-9]{8})$/i.test(color))) throw Error('invalid appearance replacement contract')
    createAppearancePlugin(value)
    return manifest
  }

  function selectAppearancePlugins(replacements = []) {
    if (!Array.isArray(replacements) || replacements.length > 4) throw Error('invalid appearance selections')
    const selected = new Map()
    for (const raw of replacements) {
      const manifest = validateAppearanceReplacement(raw)
      if (selected.has(manifest.id)) throw Error('duplicate appearance selection')
      const original = createAppearancePlugins().find(plugin => plugin.manifest.id === manifest.id)
      const plugin = createAppearancePlugin({ ...manifest.appearance, tokens: { ...original.appearance.tokens, ...manifest.appearance.tokens } })
      selected.set(manifest.id, { ...plugin, manifest, shellTokens: { ...manifest.appearance.tokens } })
    }
    return createAppearancePlugins().map(plugin => selected.get(plugin.manifest.id) || plugin)
  }

  // Compare the published data itself. Declaration defaults must not conceal
  // missing runtime fields, and object insertion order is not a contract.
  function sameAppearanceData(actual, expected) {
    if (actual === expected) return true
    if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object'
      || Array.isArray(actual) !== Array.isArray(expected)) return false
    if (Array.isArray(expected) && actual.length !== expected.length) return false
    const keys = Object.keys(expected)
    return Object.keys(actual).length === keys.length
      && keys.every(key => Object.hasOwn(actual, key) && sameAppearanceData(actual[key], expected[key]))
  }

  function createAppearanceHost({ plugins = createAppearancePlugins(), disabled = [], defaults = createAppearancePlugins() } = {}) {
    const host = createPluginHost({ disabled })
    const declarations = new Map()
    const capturedDefaults = new Map()
    let closed = false
    const requestedDisabled = new Set(disabled)
    function prepare(plugin, { signal } = {}) {
      const appearance = plugin.appearance
      // The selected trusted factory owns lifecycle work. Its appearance port
      // must agree with the immutable declaration used by package documents.
      const validated = createAppearancePlugin(appearance)
      if (plugin.manifest.id !== validated.manifest.id
        || plugin.manifest.host !== 'electron-renderer' || plugin.manifest.kind !== 'surface'
        || JSON.stringify(plugin.manifest.provides) !== JSON.stringify(validated.manifest.provides)
        || plugin.manifest.requires?.length || plugin.manifest.permissions?.length
        || typeof plugin.create !== 'function') throw Error('invalid appearance plugin contract')
      const expected = validated.appearance
      const create = plugin.create
      const interfaceName = `odk:theme/${appearance.theme}/v1`
      const validatePort = ports => {
        const value = ports?.[interfaceName]
        if (!sameAppearanceData(value, expected)) throw Error('appearance factory changes declared context')
      }
      let activationSignal = signal
      const definition = { manifest: validatePluginManifest(plugin.manifest), async create(ctx) {
        // Only the initial candidate startup belongs to the activation request.
        const startupSignal = activationSignal
        activationSignal = undefined
        let factoryContext = ctx
        let detachActivation = () => {}
        if (startupSignal) {
          const lifetime = new AbortController()
          const abort = () => lifetime.abort()
          const sources = [ctx.signal, startupSignal]
          for (const source of sources) {
            source.addEventListener('abort', abort, { once: true })
            if (source.aborted) abort()
          }
          detachActivation = () => startupSignal.removeEventListener('abort', abort)
          ctx.onCleanup(() => { for (const source of sources) source.removeEventListener('abort', abort) })
          factoryContext = { ...ctx, signal: lifetime.signal }
        }
        factoryContext.signal.throwIfAborted()
        const instance = await create(factoryContext)
        let provided
        return {
          // Host records this wrapper before reading ports. Invalid getter or
          // clone results still release the factory's acquired resources.
          get ports() { return provided ||= structuredClone(instance?.ports) },
          async start() {
            try {
              factoryContext.signal.throwIfAborted()
              if (!instance || typeof instance !== 'object' || Array.isArray(instance)) throw Error('invalid appearance instance')
              validatePort(provided)
              await instance.start?.()
              factoryContext.signal.throwIfAborted()
              validatePort(instance.ports)
            } finally { detachActivation() }
          },
          stop: () => instance?.stop?.(),
          destroy: () => instance?.destroy?.(),
        }
      } }
      return { definition, appearance: validated.appearance, releaseActivation() { activationSignal = undefined } }
    }
    for (const plugin of defaults) {
      const captured = prepare(plugin)
      if (capturedDefaults.has(plugin.manifest.id)) throw Error('duplicate Appearance default')
      capturedDefaults.set(plugin.manifest.id, captured)
    }
    for (const plugin of plugins) {
      const prepared = prepare(plugin)
      host.register(prepared.definition)
      declarations.set(prepared.appearance.theme, prepared.appearance)
    }
    host.validate()
    if (!declarations.has(DEFAULT_THEME)) throw Error('appearance composition requires Instrument fallback')
    const port = theme => `odk:theme/${theme}/v1`
    const preview = theme => {
      const enabled = new Set(host.list().filter(entry => entry.enabled).map(entry => entry.manifest.id))
      const pick = name => enabled.has(`odk.theme.${name}`) ? declarations.get(name) : null
      const selected = pick(theme) || pick(DEFAULT_THEME)
      return selected ? structuredClone(selected) : null
    }
    return {
      start() { closed = false; return host.start() },
      stop() { closed = true; return host.stop() },
      list: () => host.list(),
      setEnabled(id, enabled) {
        // Deliver disable intent immediately so it can abort pending creation.
        // The common Host serializes lifecycle work and owns cancellation.
        const result = host.setEnabled(id, enabled)
        if (typeof enabled === 'boolean' && host.list().some(plugin => plugin.manifest.id === id)) {
          if (enabled) requestedDisabled.delete(id)
          else requestedDisabled.add(id)
        }
        return result
      },
      async replace(plugin, { signal } = {}) {
        signal?.throwIfAborted()
        if (closed) throw Error('Appearance operation cancelled by shutdown')
        const prepared = prepare(plugin, { signal })
        const id = prepared.definition.manifest.id
        if (requestedDisabled.has(id) || !host.list().some(entry => entry.manifest.id === id)) {
          throw Error('Appearance replacement requires an enabled runtime identity')
        }
        if (!sameAppearanceData(declarations.get(prepared.appearance.theme), prepared.appearance)) {
          throw Error('Appearance replacement changes configured declaration')
        }
        try { await host.replace(prepared.definition, { signal }) }
        finally { prepared.releaseActivation() }
        const current = host.list().find(entry => entry.manifest.id === id)
        if (closed || requestedDisabled.has(id) || current?.state !== 'running' || !current.enabled
          || host.definition(id).create !== prepared.definition.create) throw Error('Appearance replacement incomplete')
      },
      async restoreDefault(id) {
        if (closed) throw Error('Appearance operation cancelled by shutdown')
        const captured = capturedDefaults.get(id)
        if (!captured) throw Error('Appearance has no captured built-in default')
        if (requestedDisabled.has(id) || !host.list().some(plugin => plugin.manifest.id === id)) {
          throw Error('built-in restoration requires an enabled Appearance')
        }
        if (!sameAppearanceData(declarations.get(captured.appearance.theme), captured.appearance)) {
          throw Error('Appearance restoration changes configured declaration')
        }
        await host.replace(captured.definition)
        const selected = host.list().find(plugin => plugin.manifest.id === id)
        if (closed || requestedDisabled.has(id) || selected?.state !== 'running' || !selected.enabled
          || host.definition(id).create !== captured.definition.create) throw Error('Appearance restoration incomplete after shutdown or failure')
        return { implementation: 'built-in', version: captured.definition.manifest.version, state: 'running' }
      },
      preview,
      resolve: theme => {
        const appearance = host.get(port(theme)) || host.get(port(DEFAULT_THEME))
        return appearance ? structuredClone(appearance) : null
      },
      declarations: () => [...declarations.values()].map(value => structuredClone(value)),
    }
  }

  function selectAppearanceFactories(plugins, replacements = []) {
    if (!Array.isArray(replacements) || replacements.length > plugins.length) throw Error('invalid appearance factory selections')
    const selected = new Map(plugins.map(plugin => [plugin.manifest.id, plugin]))
    const identities = new Set()
    for (const replacement of replacements) {
      const manifest = validatePluginManifest(replacement?.manifest)
      const original = selected.get(manifest.id)
      if (!original || identities.has(manifest.id) || typeof replacement.create !== 'function'
        || manifest.host !== original.manifest.host || manifest.kind !== original.manifest.kind
        || JSON.stringify(manifest.provides) !== JSON.stringify(original.manifest.provides)
        || manifest.requires.length || manifest.permissions.length
        || !replacement.appearance
        || !sameAppearanceData(replacement.appearance, original.appearance)) {
        throw Error('invalid appearance factory replacement contract')
      }
      identities.add(manifest.id)
      selected.set(manifest.id, { ...original, manifest, create: replacement.create })
    }
    const candidate = plugins.map(plugin => selected.get(plugin.manifest.id))
    createAppearanceHost({ plugins: candidate })
    return candidate
  }

  return { createAppearancePlugin, createAppearancePlugins, createAppearanceHost, validateAppearanceReplacement, selectAppearancePlugins, selectAppearanceFactories, DEFAULT_THEME, SHELL_DEFAULT_THEME, FONTS }
})
