;(function (root) {
  'use strict'

  const themes = new Map()
  let activeThemeId = 'odk.theme.default'
  let appliedTokens = []
  let activeClass = null

  // Register default base theme
  themes.set('odk.theme.default', {
    id: 'odk.theme.default',
    name: 'Minimal Dark (Default)',
    manifest: { schemaVersion: 1 },
    kind: 'theme',
    tokens: {},
    className: null,
  })

  function getDocElement() {
    return (typeof document !== 'undefined' && document.documentElement) || (root.document && root.document.documentElement) || null
  }

  function registerTheme(themeDef) {
    if (!themeDef || !themeDef.id) throw new Error('invalid theme definition')
    themes.set(themeDef.id, {
      id: themeDef.id,
      name: themeDef.name || themeDef.id,
      manifest: themeDef.manifest || { schemaVersion: 1 },
      kind: 'theme',
      tokens: themeDef.tokens || {},
      className: themeDef.className || null,
    })
  }

  function applyTheme(themeId) {
    const target = themes.get(themeId)
    if (!target) throw new Error(`unknown theme "${themeId}"`)

    const el = getDocElement()
    if (el) {
      // Revert previous tokens
      for (const key of appliedTokens) {
        el.style.removeProperty(key)
      }
      appliedTokens = []

      // Remove previous class
      if (activeClass) {
        el.classList.remove(activeClass)
        activeClass = null
      }

      // Apply new tokens
      for (const [key, value] of Object.entries(target.tokens)) {
        el.style.setProperty(key, value)
        appliedTokens.push(key)
      }

      // Add new class
      if (target.className) {
        el.classList.add(target.className)
        activeClass = target.className
      }
    }

    activeThemeId = themeId
    return target
  }

  const api = {
    registerTheme,
    applyTheme,
    currentTheme: () => activeThemeId,
    hasTheme: (id) => themes.has(id),
    listThemes: () => Array.from(themes.values()),
  }

  root.odkTheme = api
})(typeof window !== 'undefined' ? window : globalThis)
