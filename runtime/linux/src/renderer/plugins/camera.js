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
        <img class="w-camera-frame" alt="Latest camera frame" hidden />
        <span class="w-state w-camera-state">Camera unavailable</span>
      </div>`
      if (!ctx?.camera) return
      ctx.camera.subscribe((status) => render(el, status))
      void ctx.camera.refresh?.()?.catch?.(() => {})
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
