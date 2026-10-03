;
(function (root) {
  'use strict'

  // The owner's pad is not the desk's Remote Control, and this states only that
  // one is connected: a presence indicator, not a control, absent entirely while
  // no pad is connected. A pad the desk cannot read keeps the same presence with
  // a muted emphasis, because the desk must not imply it can be driven by it.
  const PAD_ICON =
    '<svg data-tabler="device-gamepad-2" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><rect x="2" y="8" width="20" height="9" rx="4.5" /><path d="M8 11v4M6 13h4" /><path d="M16 12l.01 0M18 14l.01 0" /></svg>'

  root.odkPlugins.register({
    id: 'odk.status.gamepad',
    manifest: { schemaVersion: 1 },
    kind: 'status',
    slot: 'left',
    mount(el, ctx) {
      el.innerHTML = `<span id="sb-pad" role="img" hidden>${PAD_ICON}</span>`

      const indicator = el.querySelector('#sb-pad')
      const show = (state) => {
        if (!state || state.connected !== true) {
          indicator.setAttribute('hidden', '')
          return
        }
        // SVGElement has no `hidden` IDL attribute, so the attribute on the
        // wrapper is what removes the glyph from layout and the accessibility tree.
        indicator.removeAttribute('hidden')
        indicator.dataset.readable = String(state.readable === true)
        const label = state.readable === true
          ? `Gamepad connected: ${state.id}`
          : `Gamepad connected, but the desk cannot read it: ${state.id}`
        indicator.setAttribute('aria-label', label)
        indicator.setAttribute('title', label)
      }

      show(null)
      const onState = (event) => show(event.detail)
      window.addEventListener('odk-gamepad-state', onState)
      ctx?.trackCleanup?.(() => window.removeEventListener('odk-gamepad-state', onState))
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)