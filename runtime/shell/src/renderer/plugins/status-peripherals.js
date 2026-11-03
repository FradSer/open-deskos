;(function (root) {
  'use strict'
  root.odkPlugins.register({
    id: 'odk.status.peripherals', manifest: { schemaVersion: 1 }, kind: 'status', slot: 'left',
    mount(el, ctx) {
      // The first status reports the Remote Bridge service, not a device.
      // A server glyph keeps the service and gamepad meanings separate.
      el.innerHTML = '<span class="sb-peripheral sb-remote"><svg data-tabler="server" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 7a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-2" /><path d="M3 15a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v2a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -2" /><path d="M7 8l0 .01" /><path d="M7 16l0 .01" /></svg><span class="sr-only">Remote Unknown</span></span><span class="sb-peripheral sb-camera"><svg data-tabler="camera" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h2l2 -3h6l2 3h2a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2" /><path d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" /></svg><span class="sr-only">Camera Unknown</span></span>'
      const entry = document.createElement('button')
      entry.type = 'button'
      entry.className = 'sb-devices'
      entry.setAttribute('aria-label', 'Open Devices')
      entry.title = 'Devices'
      entry.append(...el.childNodes)
      el.append(entry)
      const open = () => { void ctx.platform.openApp({ appId: 'devices' }).catch(error => console.error('Devices App failed:', error)) }
      entry.addEventListener('click', open)
      ctx.trackCleanup(() => entry.removeEventListener('click', open))
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
