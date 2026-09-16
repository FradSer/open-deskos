;(function () {
  'use strict'

  const surface = document.getElementById('voice-status')
  if (!surface || !window.odkVoice) return

  const elements = {
    content: surface.querySelector('.voice-status-content'),
    heading: surface.querySelector('.voice-status-heading'),
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
    idle: { stage: '', icon: '', title: '', detail: '', progress: false },
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
  let previousFocus = null
  let background = []

  function setVisible(visible) {
    if (visible === !surface.hidden) return
    surface.hidden = !visible
    if (visible) {
      previousFocus = document.activeElement
      background = [...document.body.children]
        .filter((node) => node !== surface && node.tagName !== 'SCRIPT')
        .map((node) => ({ node, inert: node.inert }))
      for (const { node } of background) node.inert = true
      elements.content.focus({ preventScroll: true })
      elements.content.scrollTop = 0
    } else {
      for (const { node, inert } of background) node.inert = inert
      background = []
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      previousFocus = null
    }
    window.dispatchEvent(new CustomEvent('odk-voice-visibility'))
  }

  function close() {
    if (surface.hidden) return false
    dismissed = true
    setVisible(false)
    return true
  }

  function handleInput(input) {
    if (surface.hidden || input === 'mic') return false
    if (input === 'back') close()
    if (input === 'up' || input === 'down') {
      elements.content.scrollBy({ top: input === 'down' ? 80 : -80, behavior: 'instant' })
    }
    return true
  }
  window.odkVoiceStatus = { close, handleInput, visible: () => !surface.hidden }

  window.addEventListener('keydown', (event) => {
    if (surface.hidden) return
    event.stopImmediatePropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (['Tab', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault()
      elements.content.focus({ preventScroll: true })
    } else if (!surface.contains(document.activeElement)) {
      elements.content.focus({ preventScroll: true })
    }
  }, true)

  function render(status) {
    if (!status || !Object.hasOwn(presentation, status.state)) return
    const copy = presentation[status.state]
    const busy = busyStates.has(status.state)
    if (status.activated === true || status.state === 'starting' || (busy && !active)) {
      active = true
      dismissed = false
    }
    setVisible(active && !dismissed && !(status.state === 'idle' && !status.message))
    if (status.state === 'idle' && !status.message) active = false
    surface.dataset.state = status.state
    elements.heading.hidden = status.state === 'idle'
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

  window.odkVoice.subscribe(render)
})()
