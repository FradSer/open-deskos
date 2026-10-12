;(function (root) {
  'use strict'

  // Markup and Shell styles are shared visual assets; reading and lifetime logic are independent.
  const markup = `
      <div class="widget-signal w-camera-body">
        <span class="widget-status-name">Camera</span>
        <div class="w-camera-figure">
          <img class="w-camera-frame" alt="Latest camera frame" hidden />
          <svg class="w-camera-marks" data-tabler="camera-viewfinder" aria-hidden="true" viewBox="0 0 24 24" preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path stroke="none" d="M0 0h24v24H0z" fill="none" />
            <path d="M4 9V4h5" />
            <path d="M15 4h5v5" />
            <path d="M20 15v5h-5" />
            <path d="M9 20H4v-5" />
          </svg>
        </div>
        <span class="w-state w-camera-state">Camera unavailable</span>
      </div>`

  root.odkRendererDevelopment.define({
    id: 'odk.tile.camera', manifest: { schemaVersion: 1, version: '2.0.0' },
    kind: 'tile', app: 'Camera', state: 'Camera unavailable', interaction: 'display-only',
    mount(element, context) {
      element.innerHTML = markup
      const service = context?.camera
      if (!service) return
      const image = element.querySelector('.w-camera-frame')
      const caption = element.querySelector('.w-camera-state')
      let alive = true
      context.trackCleanup(() => { alive = false })
      context.trackCleanup(service.subscribe(reading => {
        if (!alive || !image || !caption) return
        const visible = reading?.status === 'live' && typeof reading?.frame === 'string'
        image.hidden = !visible
        if (!visible) {
          image.removeAttribute('src')
          caption.textContent = 'Camera unavailable'
          return
        }
        image.src = reading.frame
        const date = reading.capturedAt ? new Date(reading.capturedAt) : null
        const time = date && Number.isFinite(date.getTime())
          ? [date.getHours(), date.getMinutes()].map(part => `${part}`.padStart(2, '0')).join(':') : ''
        caption.textContent = `Updated ${time}`
      }))
      void service.refresh?.()?.catch?.(() => {})
    },
  })
})(window)
