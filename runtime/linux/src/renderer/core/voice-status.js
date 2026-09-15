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
    starting: { stage: 'Preparing', icon: 'microphone', title: 'Opening microphone', detail: 'Voice Agent is getting ready', progress: false },
    sending: { stage: 'Submitting', icon: 'arrow-up', title: 'Sending request', detail: 'Recording stopped. Preparing transcription', progress: true },
    recording: { stage: 'Listening', icon: 'microphone', title: 'Speak naturally', detail: 'Press MIC again to stop and send', progress: false },
    transcribing: { stage: 'Transcribing', icon: 'wave-sine', title: 'Turning speech into text', detail: 'Your recording is being prepared for Pi', progress: true },
    thinking: { stage: 'Executing', icon: 'arrow-right', title: 'Pi is working', detail: 'Running the request in the Voice Agent workspace', progress: true },
    error: { stage: 'Needs attention', icon: 'alert-triangle', title: 'Voice request failed', detail: 'Check the Voice Agent configuration and try again', progress: false },
    unavailable: { stage: 'Unavailable', icon: 'microphone-off', title: 'Voice Agent is offline', detail: 'Start the voice service or check its configuration', progress: false },
    idle: { stage: 'Complete', icon: 'check', title: 'Request complete', detail: '', progress: false },
  }

  function detailFor(status, copy) {
    if (status.state === 'unavailable') return copy.detail
    if (status.state === 'error') {
      return status.message ? `${status.message}\n${copy.detail}` : copy.detail
    }
    return status.message || copy.detail
  }

  function render(status) {
    if (!status || !Object.hasOwn(presentation, status.state)) return
    const copy = presentation[status.state]
    surface.hidden = status.state === 'idle' && !status.message
    surface.dataset.state = status.state
    elements.stage.textContent = copy.stage
    elements.icon.dataset.stateIcon = copy.icon
    elements.title.textContent = copy.title
    elements.detail.textContent = detailFor(status, copy)
    elements.progress.hidden = !copy.progress
    elements.timing.hidden = status.state !== 'recording'
    elements.limit.textContent = 'Stops automatically after 30 seconds'
  }

  window.odkVoice.subscribe(render)
})()
