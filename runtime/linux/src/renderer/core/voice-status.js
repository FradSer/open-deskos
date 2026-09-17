;(function () {
  'use strict'

  const surface = document.getElementById('voice-status')
  if (!surface || !window.odkVoice) return

  const elements = {
    content: surface.querySelector('.voice-status-content'),
    heading: surface.querySelector('.voice-status-heading'),
    input: surface.querySelector('.voice-status-input'),
    transcript: surface.querySelector('.voice-status-transcript'),
    stage: surface.querySelector('.voice-status-stage'),
    icon: surface.querySelector('.voice-status-icon'),
    title: surface.querySelector('.voice-status-title'),
    detail: surface.querySelector('.voice-status-detail'),
    progress: surface.querySelector('.voice-status-progress'),
    level: surface.querySelector('.voice-status-level'),
    levelLine: surface.querySelector('.voice-status-level span'),
  }
  if (Object.values(elements).some((element) => !element)) return

  const presentation = {
    starting: { stage: 'Preparing', icon: 'microphone', title: '', detail: '', progress: false },
    sending: { stage: 'Submitting', icon: 'arrow-up', title: '', detail: '', progress: true },
    recording: { stage: 'Listening', icon: 'microphone', title: '', detail: '', progress: false },
    transcribing: { stage: 'Transcribing', icon: 'wave-sine', title: '', detail: '', progress: true },
    thinking: { stage: 'Working', icon: 'arrow-right', title: '', detail: '', progress: true },
    error: { stage: 'Needs attention', icon: 'alert-triangle', title: '', detail: 'Check the Voice Agent configuration and try again', progress: false },
    unavailable: { stage: 'Unavailable', icon: 'microphone-off', title: '', detail: 'Start the voice service or check its configuration', progress: false },
    idle: { stage: '', icon: '', title: '', detail: '', progress: false },
  }

  function detailFor(status, copy) {
    if (['starting', 'recording', 'sending', 'transcribing', 'thinking'].includes(status.state)) return ''
    if (status.state === 'unavailable') return copy.detail
    if (status.state === 'error') {
      return status.message ? `${status.message}\n${copy.detail}` : copy.detail
    }
    return status.message || copy.detail
  }

  let active = false
  let dismissed = false
  const busyStates = new Set(['starting', 'sending', 'transcribing', 'thinking'])
  let togglePending = false
  let savedScrollTop = 0
  let previousFocus = null
  let background = []
  let lastState
  let lastTitle
  let lastDetail
  let lastTranscript

  function setVisible(visible) {
    if (visible === !surface.hidden) return
    if (!visible) savedScrollTop = elements.content.scrollTop
    surface.hidden = !visible
    if (visible) {
      previousFocus = document.activeElement
      background = [...document.body.children]
        .filter((node) => node !== surface && node.tagName !== 'SCRIPT')
        .map((node) => ({ node, inert: node.inert }))
      for (const { node } of background) node.inert = true
      elements.content.focus({ preventScroll: true })
      elements.content.scrollTop = savedScrollTop
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
  async function mic() {
    if (active && surface.hidden) {
      dismissed = false
      setVisible(true)
      return
    }
    if (togglePending || busyStates.has(lastState)) return
    togglePending = true
    dismissed = false
    try {
      await window.odkVoice.toggle()
    } catch {
      active = true
      render({ state: 'error', message: 'Unable to control recording', transcript: lastTranscript })
    } finally {
      togglePending = false
    }
  }
  window.odkVoiceStatus = { close, handleInput, mic, visible: () => !surface.hidden }

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
    const newRecording = status.state === 'starting' && lastState !== 'starting'
    const activates = status.activated === true || newRecording || busyStates.has(status.state) || status.state === 'recording'
    if (activates && (!active || newRecording || status.activated === true)) {
      active = true
      if (!togglePending && (newRecording || status.activated === true)) dismissed = false
    }
    if (newRecording) {
      savedScrollTop = 0
      elements.content.scrollTop = 0
    }
    const emptyIdle = status.state === 'idle' && !status.message && !status.transcript
    setVisible(active && !dismissed && !emptyIdle)
    if (emptyIdle) active = false
    surface.dataset.state = status.state
    const streaming = status.state === 'thinking' || (lastState === 'thinking' && status.state === 'idle')
    const top = elements.content.scrollTop
    const atBottom = elements.content.scrollHeight - elements.content.clientHeight - top <= 1
    const changed = renderContent(status, copy)
    if (changed && streaming && !surface.hidden) {
      elements.content.scrollTop = atBottom ? elements.content.scrollHeight : top
    }
    const level = status.state === 'recording' && Number.isFinite(status.level) ? status.level : 0
    elements.levelLine.style.width = `${Math.sqrt(Math.max(0, Math.min(1, level))) * 100}%`
  }

  function renderContent(status, copy) {
    const title = ['thinking', 'idle'].includes(status.state) ? status.message || '' : copy.title
    const detail = status.state === 'idle' ? '' : detailFor(status, copy)
    const transcript = ['thinking', 'idle', 'error'].includes(status.state) ? status.transcript || '' : ''
    const changed = status.state !== lastState || title !== lastTitle || detail !== lastDetail || transcript !== lastTranscript
    if (status.state !== lastState) {
      elements.title.setAttribute('aria-busy', String(status.state === 'thinking'))
      elements.heading.hidden = status.state === 'idle'
      elements.stage.textContent = copy.stage
      elements.icon.dataset.stateIcon = copy.icon
      elements.progress.hidden = !copy.progress
      elements.level.hidden = status.state !== 'recording'
      lastState = status.state
    }
    if (transcript !== lastTranscript) {
      elements.transcript.textContent = transcript
      elements.input.hidden = !transcript
      lastTranscript = transcript
    }
    if (title !== lastTitle) {
      window.odkVoiceReply.render(elements.title, title)
      elements.title.hidden = !title
      lastTitle = title
    }
    if (detail !== lastDetail) {
      elements.detail.textContent = detail
      elements.detail.hidden = !detail
      lastDetail = detail
    }
    return changed
  }

  window.odkVoice.subscribe(render)
  window.odkVoice.onMic(mic)
})()
