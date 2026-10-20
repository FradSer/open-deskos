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

  const HEADING_ICONS = {
    'odk.tile.pi-sessions': { name: 'terminal-2', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M8 9l3 3l-3 3\" /><path d=\"M13 15l3 0\" /><path d=\"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12\" />" },
    'odk.tile.pomodoro': { name: 'hourglass', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M6.5 7h11\" /><path d=\"M6.5 17h11\" /><path d=\"M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1\" /><path d=\"M6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1\" />" },
    'odk.tile.futu': { name: 'chart-line', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M4 19l16 0\" /><path d=\"M4 15l4 -6l4 2l4 -5l4 4\" />" },
    'odk.tile.year': { name: 'calendar', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12\" /><path d=\"M16 3v4\" /><path d=\"M8 3v4\" /><path d=\"M4 11h16\" /><path d=\"M11 15h1\" /><path d=\"M12 15v3\" />" },
    'odk.tile.weather': { name: 'weather-cloud', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878\" />" },
    'odk.tile.quota': { name: 'sparkles', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6\" />" },
    'odk.tile.clock': { name: 'clock', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" /><path d=\"M12 7v5l3 3\" />" },
    'odk.tile.almanac': { name: 'calendar', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12\" /><path d=\"M16 3v4\" /><path d=\"M8 3v4\" /><path d=\"M4 11h16\" /><path d=\"M11 15h1\" /><path d=\"M12 15v3\" />" },
    'odk.tile.preorder': { name: 'shopping-bag', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M6.331 8h11.339a2 2 0 0 1 1.977 2.304l-1.255 8.152a3 3 0 0 1 -2.966 2.544h-6.852a3 3 0 0 1 -2.965 -2.544l-1.255 -8.152a2 2 0 0 1 1.977 -2.304\" /><path d=\"M9 11v-5a3 3 0 0 1 6 0v5\" />" },
    'odk.tile.weread': { name: 'book-open', paths: "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0\" /><path d=\"M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0\" /><path d=\"M3 6l0 13\" /><path d=\"M12 6l0 13\" /><path d=\"M21 6l0 13\" />" },
  }

  function applyHeadings(scope) {
    const cards = [...scope.querySelectorAll('.widget[data-widget]')]
    if (scope.matches?.('.widget[data-widget]')) cards.unshift(scope)
    for (const card of cards) {
      const heading = card.querySelector('.widget-heading,.weread-title')
      if (!heading || heading.closest('.widget-title')) continue
      const existing = heading.previousElementSibling
      if (existing?.matches('svg[data-tabler]')) {
        existing.classList.add('widget-heading-icon')
        existing.setAttribute('focusable', 'false')
        continue
      }
      const definition = HEADING_ICONS[card.dataset.widget]
      if (!definition) continue
      const wrapper = card.ownerDocument.createElement('span')
      wrapper.className = 'widget-title'
      const svg = card.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
      for (const [name, value] of Object.entries({ ...TABLER_ATTRS, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false', 'data-tabler': definition.name, class: 'widget-heading-icon' })) svg.setAttribute(name, value)
      svg.innerHTML = definition.paths
      heading.before(wrapper)
      wrapper.append(svg, heading)
    }
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
    const target = scope || root.document
    applyHeadings(target)
    for (const svg of target.querySelectorAll('svg[data-tabler]')) {
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
