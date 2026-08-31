;(function (root) {
  'use strict'

  const ICONS = {
    detected: '<svg data-tabler="user-scan" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M8 7a4 4 0 1 1 8 0a4 4 0 0 1 -8 0"/><path d="M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2"/><path d="M3 4v3"/><path d="M3 4h3"/><path d="M21 4v3"/><path d="M18 4h3"/></svg>',
    unavailable: '<svg data-tabler="user-off" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M8 7a4 4 0 0 1 5.3 -3.8"/><path d="M16 10a4 4 0 0 1 -6.6 3"/><path d="M11 15h-1a4 4 0 0 0 -4 4v2"/><path d="M15 15h1a4 4 0 0 1 4 4v2"/><path d="M3 3l18 18"/></svg>',
  }

  function text(className, value) {
    const node = document.createElement('span')
    node.className = className
    node.textContent = value
    return node
  }

  function stateLabel(status, recognized) {
    if (recognized) return status.facesCount === 1 ? 'Owner recognized' : 'Owner recognized among detected faces'
    if (status.state === 'unknown-face') return 'Unknown face · screen locked'
    if (status.state === 'no-face') return 'No face detected · screen locked'
    if (status.state === 'starting') return 'Face Agent starting · screen locked'
    if (status.state === 'no-frame') return 'Face Agent running · no camera frame'
    if (status.state === 'camera-unavailable') return 'Face Agent running · camera unavailable'
    return 'Face Agent unavailable · screen locked'
  }

  function render(el, status) {
    const recognized = status.unlocked === true
    const state = stateLabel(status, recognized)
    el.replaceChildren()
    el.insertAdjacentHTML('beforeend', recognized ? ICONS.detected : ICONS.unavailable)
    el.append(
      text('w-name', 'Face presence'),
      text('w-vision-value', recognized ? String(status.facesCount) : '--'),
      text('w-state', state),
    )
  }

  root.odkPlugins.register({
    id: 'face-presence',
    kind: 'tile',
    app: 'Face presence',
    state: 'Face Agent unavailable',
    interaction: 'display-only',
    mount(el, ctx) {
      ctx.faceAgent.subscribe((status) => render(el, status))
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
