;(function () {
  'use strict'

  const surface = document.getElementById('voice-status')
  if (!surface || !window.odkVoice) return

  const title = surface.querySelector('.voice-status-title')
  const detail = surface.querySelector('.voice-status-detail')
  const meter = surface.querySelector('.voice-status-meter')
  if (!title || !detail || !meter) return

  const presentation = {
    starting: { title: 'Starting Voice Agent', detail: 'Opening the microphone', progress: true },
    sending: { title: 'Sending', detail: 'Submitting the recorded request', progress: true },
    recording: { title: 'Listening', detail: 'Press MIC again to stop and send', progress: false },
    transcribing: { title: 'Transcribing', detail: 'Turning speech into a request', progress: true },
    thinking: { title: 'Pi is working', detail: 'Running the Voice Agent', progress: true },
    error: { title: 'Voice command failed', detail: 'Check the Voice Agent configuration', progress: false },
    unavailable: { title: 'Voice unavailable', detail: 'The resident Voice Agent is not connected', progress: false },
    idle: { title: 'Complete', detail: '', progress: false },
  }

  function render(status) {
    if (!status || !Object.hasOwn(presentation, status.state)) return
    const copy = presentation[status.state]
    surface.hidden = status.state === 'idle' && !status.message
    surface.dataset.state = status.state
    title.textContent = copy.title
    detail.textContent = status.message || copy.detail
    meter.hidden = status.state === 'idle'
  }

  window.odkVoice.subscribe(render)
})()
