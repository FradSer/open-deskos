;(function () {
  'use strict'

  const surface = document.getElementById('voice-status')
  if (!surface || !window.odkVoice) return

  const elements = {
    stage: surface.querySelector('.voice-status-stage'),
    icon: surface.querySelector('.voice-status-icon'),
    title: surface.querySelector('.voice-status-title'),
    detail: surface.querySelector('.voice-status-detail'),
    progress: surface.querySelector('.voice-status-progress'),
    timing: surface.querySelector('.voice-status-timing'),
    limit: surface.querySelector('.voice-status-limit'),
  }
  if (Object.values(elements).some((element) => !element)) return

  const presentation = {
    starting: { stage: 'Preparing', icon: 'microphone', title: '', detail: '', progress: false },
    sending: { stage: 'Submitting', icon: 'arrow-up', title: '', detail: '', progress: true },
    recording: { stage: 'Listening', icon: 'microphone', title: '', detail: 'Press MIC again to submit', progress: false },
    transcribing: { stage: 'Transcribing', icon: 'wave-sine', title: '', detail: '', progress: true },
    thinking: { stage: 'Working', icon: 'arrow-right', title: '', detail: '', progress: true },
    error: { stage: 'Needs attention', icon: 'alert-triangle', title: '', detail: 'Check the Voice Agent configuration and try again', progress: false },
    unavailable: { stage: 'Unavailable', icon: 'microphone-off', title: '', detail: 'Start the voice service or check its configuration', progress: false },
    idle: { stage: 'Complete', icon: 'check', title: '', detail: '', progress: false },
  }

  function detailFor(status, copy) {
    if (status.state === 'unavailable') return copy.detail
    if (status.state === 'error') {
      return status.message ? `${status.message}\n${copy.detail}` : copy.detail
    }
    return status.message || copy.detail
  }

  let active = false
  let dismissed = false
  const busyStates = new Set(['starting', 'recording', 'sending', 'transcribing', 'thinking'])
  function close() {
    if (surface.hidden) return false
    dismissed = true
    surface.hidden = true
    return true
  }
  window.odkVoiceStatus = { close }

  surface.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.stopPropagation()
    }
  })

  function render(status) {
    if (!status || !Object.hasOwn(presentation, status.state)) return
    const copy = presentation[status.state]
    const busy = busyStates.has(status.state)
    if (status.activated === true || status.state === 'starting' || (busy && !active)) {
      active = true
      dismissed = false
    }
    surface.hidden = !active || dismissed || (status.state === 'idle' && !status.message)
    if (status.state === 'idle' && !status.message) active = false
    surface.dataset.state = status.state
    elements.stage.textContent = copy.stage
    elements.icon.dataset.stateIcon = copy.icon
    elements.title.textContent = status.state === 'idle' ? status.message || '' : copy.title
    elements.title.hidden = !elements.title.textContent
    elements.detail.textContent = status.state === 'idle' ? '' : detailFor(status, copy)
    elements.detail.hidden = !elements.detail.textContent
    elements.progress.hidden = !copy.progress
    elements.timing.hidden = status.state !== 'recording'
    elements.limit.textContent = 'Stops automatically after 30 seconds'
  }

  window.addEventListener('DOMContentLoaded', () => {
    const appView = document.getElementById('app-view')
    const home = surface.parentElement
    const placeSurface = () => {
      const parent = appView.hidden ? home : appView
      if (surface.parentElement !== parent) parent.append(surface)
    }
    const observer = new MutationObserver(placeSurface)
    observer.observe(appView, { attributes: true, attributeFilter: ['hidden'] })
    placeSurface()
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true })
  }, { once: true })

  window.odkVoice.subscribe(render)
})()
