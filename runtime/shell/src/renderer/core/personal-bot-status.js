;(function () {
  'use strict'

  const surface = document.getElementById('personal-bot-status')
  if (!surface || !window.odkPersonalBot) return

  const elements = {
    content: surface.querySelector('.personal-bot-status-content'),
    heading: surface.querySelector('.personal-bot-status-heading'),
    input: surface.querySelector('.personal-bot-status-input'),
    transcript: surface.querySelector('.personal-bot-status-transcript'),
    stage: surface.querySelector('.personal-bot-status-stage'),
    icon: surface.querySelector('.personal-bot-status-icon'),
    title: surface.querySelector('.personal-bot-status-title'),
    detail: surface.querySelector('.personal-bot-status-detail'),
    progress: surface.querySelector('.personal-bot-status-progress'),
    level: surface.querySelector('.personal-bot-status-level'),
    levelLine: surface.querySelector('.personal-bot-status-level span'),
  }
  if (Object.values(elements).some((element) => !element)) return

  function messageText(status) {
    const messages = [typeof status.message === 'string' ? status.message : '']
    if (Array.isArray(status.notifications)) {
      for (const notification of status.notifications) if (typeof notification?.message === 'string') messages.push(notification.message)
    }
    return messages.filter(Boolean).join('\n\n')
  }

  const presentation = {
    starting: { stage: 'Preparing', icon: 'microphone', title: '', detail: '', progress: false },
    sending: { stage: 'Submitting', icon: 'arrow-up', title: '', detail: '', progress: true },
    recording: { stage: 'Listening', icon: 'microphone', title: '', detail: '', progress: false },
    transcribing: { stage: 'Transcribing', icon: 'wave-sine', title: '', detail: '', progress: true },
    thinking: { stage: 'Working', icon: 'arrow-right', title: '', detail: '', progress: true },
    error: { stage: 'Needs attention', icon: 'alert-triangle', title: '', detail: 'Check the Personal Bot configuration and try again', progress: false },
    unavailable: { stage: 'Unavailable', icon: 'microphone-off', title: '', detail: 'Start the personal bot service or check its configuration', progress: false },
    idle: { stage: '', icon: '', title: '', detail: '', progress: false },
  }

  function detailFor(status, copy) {
    if (['starting', 'recording', 'sending', 'transcribing', 'thinking'].includes(status.state)) return ''
    if (status.state === 'unavailable') return copy.detail
    if (status.state === 'error') {
      const message = messageText(status)
      return message ? `${message}\n${copy.detail}` : copy.detail
    }
    return messageText(status) || copy.detail
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

  const residentHome = () => Boolean(document.querySelector('#personal-agent .agent-panel') && document.getElementById('app-view')?.hidden)
  function setVisible(visible) {
    // The resident panel owns home feedback. Keep modal voice feedback inside Apps.
    if (residentHome()) visible = false
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
    } else if (!visible) {
      for (const { node, inert } of background) node.inert = inert
      background = []
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
      previousFocus = null
    }
    window.dispatchEvent(new CustomEvent('odk-personal-bot-visibility'))
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
    if (active && surface.hidden && !residentHome()) {
      dismissed = false
      setVisible(true)
      return
    }
    if (togglePending || busyStates.has(lastState)) return
    togglePending = true
    dismissed = false
    try {
      const receipt = await window.odkPersonalBot.toggle()
      if (receipt === false || receipt?.accepted === false) {
        if (!['error', 'unavailable'].includes(lastState)) {
          active = true
          render({ state: 'error', message: 'Unable to control recording', transcript: lastTranscript })
        }
        return { accepted: false }
      }
      return receipt || { accepted: true }
    } catch {
      active = true
      render({ state: 'error', message: 'Unable to control recording', transcript: lastTranscript })
      return { accepted: false }
    } finally {
      togglePending = false
    }
  }
  window.odkPersonalBotStatus = { close, handleInput, mic, visible: () => !surface.hidden }

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
    const emptyIdle = status.state === 'idle' && !messageText(status) && !status.transcript
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
    const title = ['thinking', 'idle'].includes(status.state) ? messageText(status) : copy.title
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
      window.odkPersonalBotReply.render(elements.title, title)
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

  window.odkPersonalBot.subscribe(render)
  window.odkPersonalBot.onMic(mic)
})()
