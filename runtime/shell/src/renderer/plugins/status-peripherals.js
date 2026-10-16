;(function (root) {
  'use strict'
  root.odkPlugins.register({
    id: 'odk.status.peripherals', manifest: { schemaVersion: 1 }, kind: 'status', slot: 'left',
    mount(el, ctx) {
      el.innerHTML = '<span class="sb-peripheral sb-remote"><svg data-tabler="device-gamepad-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="8" width="20" height="9" rx="4.5" /><path d="M8 11v4M6 13h4M16 12l.01 0M18 14l.01 0" /></svg><span class="sr-only">Remote Unknown</span></span><span class="sb-peripheral sb-camera"><svg data-tabler="camera" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h2l2 -3h6l2 3h2a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2" /><path d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /></svg><span class="sr-only">Camera Unknown</span></span>'
      const show = (selector, state, value) => {
        if (ctx.signal?.aborted) return
        const indicator = el.querySelector(selector)
        const label = `${selector === '.sb-remote' ? 'Remote' : 'Camera'} ${value}`
        indicator.dataset.state = state
        indicator.setAttribute('role', 'img')
        indicator.setAttribute('aria-label', label)
        indicator.setAttribute('title', label)
        indicator.querySelector('span').textContent = label
      }
      const remote = ctx.services?.get('odk.service.remoteLink')
      const labels = { unknown: 'Unknown', unavailable: 'Unavailable', disconnected: 'Disconnected', usb: 'USB', wireless: 'Wireless', syncing: 'Synchronizing' }
      if (remote) ctx.trackCleanup(remote.subscribe(value => show('.sb-remote', value, labels[value] || 'Unknown')))
      else show('.sb-remote', 'unavailable', 'Unavailable')
      if (ctx.camera) ctx.trackCleanup(ctx.camera.subscribe(value => show('.sb-camera', value?.status || 'unknown', ({ live: 'Frame live', unavailable: 'Unavailable', disconnected: 'Disconnected' })[value?.status] || 'Unknown')))
      else show('.sb-camera', 'unavailable', 'Unavailable')
    },
  })
})(window)
