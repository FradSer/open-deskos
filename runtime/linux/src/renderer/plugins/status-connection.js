;
(function (root) {
  'use strict'

  // A reachability indicator, not a control: the glyph carries the state so the
  // Shell never relies on color alone, and color only adds emphasis while online.
  const ONLINE_ICON = '<svg data-tabler="wifi" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 18l.01 0" /><path d="M9.172 15.172a4 4 0 0 1 5.656 0" /><path d="M6.343 12.343a8 8 0 0 1 11.314 0" /><path d="M3.515 9.515c4.686 -4.687 12.284 -4.687 17 0" /></svg>'
  const OFFLINE_ICON = '<svg data-tabler="wifi-off" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M12 18l.01 0" /><path d="M9.172 15.172a4 4 0 0 1 5.656 0" /><path d="M6.343 12.343a7.963 7.963 0 0 1 3.864 -2.14m4.163 .155a7.965 7.965 0 0 1 3.287 2" /><path d="M3.515 9.515a12 12 0 0 1 3.544 -2.455m3.101 -.92a12 12 0 0 1 10.325 3.374" /><path d="M3 3l18 18" /></svg>'

  function setIconVisible(svg, visible) {
    // SVGElement has no `hidden` IDL attribute, so the attribute is the only
    // thing that removes the glyph from layout and the accessibility tree.
    if (visible) svg.removeAttribute('hidden')
    else svg.setAttribute('hidden', '')
  }

  root.odkPlugins.register({
    id: 'odk.status.connection',
    manifest: { schemaVersion: 1 },
    kind: 'status',
    slot: 'left',
    mount(el, ctx) {
      el.innerHTML = `
        <span class="sb-net" id="sb-net" role="img">${ONLINE_ICON}${OFFLINE_ICON}</span>`

      const indicator = el.querySelector('#sb-net')
      const online = indicator.querySelector('[data-tabler="wifi"]')
      const offline = indicator.querySelector('[data-tabler="wifi-off"]')

      ctx.connection.subscribe((reachable) => {
        // The reachability value carries the same truth as the status
        // announcement, so the indicator never disagrees with it.
        const label = ctx.connection.labelFor(reachable)
        setIconVisible(online, reachable)
        setIconVisible(offline, !reachable)
        indicator.dataset.online = String(reachable)
        indicator.setAttribute('aria-label', label)
        indicator.setAttribute('title', label)
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)