;
(function (root) {
  'use strict'

  root.odkPlugins.register({
    id: 'odk.status.connection',
    manifest: { schemaVersion: 1 },
    kind: 'status',
    slot: 'left',
    mount(el, ctx) {
      el.innerHTML = `
        <svg id="sb-net" data-tabler="bolt" role="img" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="${ctx.NETWORK_LABELS.disconnected}"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11" /></svg>`

      const bolt = el.querySelector('#sb-net')
      ctx.connection.subscribe((online) => {
        bolt.classList.toggle('on', online)
        bolt.setAttribute('aria-label', ctx.connection.label())
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
