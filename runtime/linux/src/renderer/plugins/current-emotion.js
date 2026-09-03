;(function (root) {
  'use strict'

  const LABELS = {
    neutral: 'Neutral',
    happiness: 'Happiness',
    surprise: 'Surprise',
    sadness: 'Sadness',
    anger: 'Anger',
    disgust: 'Disgust',
    fear: 'Fear',
    contempt: 'Contempt',
  }
  const ICON = '<svg data-tabler="mood-smile" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 21a9 9 0 1 0 0 -18a9 9 0 0 0 0 18z"/><path d="M9 10h.01"/><path d="M15 10h.01"/><path d="M8 14s1.5 2 4 2s4 -2 4 -2"/></svg>'

  function text(className, value) {
    const node = document.createElement('span')
    node.className = className
    node.textContent = value
    return node
  }

  function detailLabel(status, emotion) {
    if (emotion && status.unlocked) return `${emotion.confidence}% confidence`
    if (status.state === 'unknown-face') return 'Owner not recognized · experimental status'
    if (status.state === 'no-face') return 'No face detected · experimental status'
    if (status.state === 'starting') return 'Face Agent starting · experimental status'
    if (status.state === 'no-frame') return 'No camera frame available'
    if (status.state === 'camera-unavailable') return 'Camera unavailable'
    if (status.state === 'unavailable') return 'Face Agent unavailable'
    return 'Owner recognition required'
  }

  function render(el, status) {
    const emotion = status.unlocked ? status.emotion : null
    const detail = detailLabel(status, emotion)
    el.innerHTML = `
      <div class="widget-header odk-row items-center justify-between w-full">
        <span class="w-name">Current emotion</span>
        <span class="widget-glance-badge">EMOTION</span>
      </div>
      <div class="widget-icon-body odk-row items-center justify-center gap-3">
        ${ICON}
        <span class="w-emotion">${emotion ? LABELS[emotion.primary] : '--'}</span>
      </div>
      <span class="w-state">${detail}</span>`
  }

  root.odkPlugins.register({
    id: 'odk.tile.current-emotion',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Current emotion',
    state: 'Face Agent unavailable',
    interaction: 'display-only',
    mount(el, ctx) {
      ctx.faceAgent.subscribe((status) => render(el, status))
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
