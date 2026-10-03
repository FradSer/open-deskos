;
(function (root) {
  'use strict'

  const key = 'odk.theme'
  const html = document.documentElement
  function set(value) {
    const theme = (value === 'border-beam' || value === 'pixel') ? value : 'instrument'
    html.dataset.theme = theme
    try {
      root.localStorage.setItem(key, theme)
    } catch {
      // Preferences may be unavailable; appearance still works in this session.
    }
  }

  let saved = 'pixel'
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
  root.odkTheme = { set, get: () => html.dataset.theme }
})(window)
