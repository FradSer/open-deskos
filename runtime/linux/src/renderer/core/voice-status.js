;(function () {
  'use strict'

  const surface = document.getElementById('voice-status')
  if (!surface || !window.odkVoice) return
  const labels = {
    recording: 'Listening — press MIC to stop and send',
    transcribing: 'Transcribing voice…',
    thinking: 'Voice agent is working…',
    error: 'Voice command failed',
    unavailable: 'Voice service unavailable',
    idle: 'Voice agent ready',
  }
  window.odkVoice.subscribe((status) => {
    if (!status || !Object.hasOwn(labels, status.state)) return
    surface.hidden = status.state === 'idle' && !status.message
    surface.dataset.state = status.state
    surface.textContent = status.message ? `${labels[status.state]} · ${status.message}` : labels[status.state]
  })
})()
