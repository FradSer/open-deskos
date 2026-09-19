;
(function (root) {
  'use strict'

  function formatTime(capturedAt) {
    if (!capturedAt) return ''
    const at = new Date(capturedAt)
    if (Number.isNaN(at.getTime())) return ''
    const pad = (value) => String(value).padStart(2, '0')
    return `${pad(at.getHours())}:${pad(at.getMinutes())}`
  }

  function render(el, status) {
    const live = status?.status === 'live' && typeof status?.frame === 'string'
    const frame = el.querySelector('.w-camera-frame')
    const state = el.querySelector('.w-camera-state')
    if (!frame || !state) return
    frame.hidden = !live
    if (live) frame.src = status.frame
    else frame.removeAttribute('src')
    state.textContent = live ? `Updated ${formatTime(status.capturedAt)}` : 'Camera unavailable'
  }

  root.odkPlugins.register({
    id: 'odk.tile.camera',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Camera',
    state: 'Camera unavailable',
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
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
      if (!ctx?.camera) return
      ctx.camera.subscribe((status) => render(el, status))
      void ctx.camera.refresh?.()?.catch?.(() => {})
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
