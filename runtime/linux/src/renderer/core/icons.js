;
(function (root) {
  'use strict'

  const html = root.document.documentElement
  const originals = new WeakMap()
  const applied = new WeakMap()
  const TABLER_ATTRS = {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }

  function isPixelTheme() {
    return html.dataset.theme === 'pixel'
  }

  function applyIcon(svg) {
    const paths = root.PIXELARTICON_PATHS
    const name = svg.dataset.tabler
    if (!paths || !paths[name]) return
    const target = isPixelTheme() ? 'pixel' : 'tabler'
    if (applied.get(svg) === target) return
    if (!originals.has(svg)) originals.set(svg, svg.innerHTML)
    applied.set(svg, target)
    if (target === 'pixel') {
      for (const attr of Object.keys(TABLER_ATTRS)) svg.removeAttribute(attr)
      svg.setAttribute('fill', 'currentColor')
      svg.innerHTML = paths[name]
    } else {
      for (const [attr, value] of Object.entries(TABLER_ATTRS)) svg.setAttribute(attr, value)
      svg.innerHTML = originals.get(svg)
    }
  }

  function apply(scope) {
    for (const svg of (scope || root.document).querySelectorAll('svg[data-tabler]')) {
      applyIcon(svg)
    }
  }

  function applyCurrent() {
    apply(root.document)
  }

  root.odkIcons = { apply, applyCurrent }

  /*
   * Plugins mount and re-render after this script; the observer keeps every
   * svg[data-tabler] on the current icon theme and re-applies on theme change.
   * applyIcon is variant-guarded, so each pass settles without further
   * mutations.
   */
  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(applyCurrent).observe(html, {
      attributes: true,
      attributeFilter: ['data-theme'],
      childList: true,
      subtree: true,
    })
  }
})(typeof window !== 'undefined' ? window : globalThis)
