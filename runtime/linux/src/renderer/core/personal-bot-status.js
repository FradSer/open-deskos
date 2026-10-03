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
      return status.message ? `${status.message}\n${copy.detail}` : copy.detail
    }
    return status.message || copy.detail
  }

  let proposals
  let proactive = false
  let proposalSnapshot = ''
  let proposalError = ''

  async function command(value) {
    try {
      const receipt = await window.odkPersonalBot.proposalCommand(value)
      if (!receipt?.accepted) throw Error('Unavailable')
    } catch {
      proposalError = 'Suggestion response was not delivered. Check the personal bot service; do not repeat an uncertain action.'
      showProposalError()
    }
  }
  function showProposalError() {
    let error = proposals.querySelector('.personal-bot-proposal-error')
    if (!error) {
      error = document.createElement('p')
      error.className = 'personal-bot-proposal-error'
      error.setAttribute('role', 'status')
      proposals.appendChild(error)
    }
    error.textContent = proposalError
  }
  function button(label, callback) {
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = label
    node.addEventListener('click', callback)
    return node
  }
  function renderProposals(status) {
    if (!Array.isArray(status.proposals)) return
    if (!proposals) {
      if (!status.proposals.length) return
      proposals = document.createElement('section')
      proposals.className = 'personal-bot-proposals'
      proposals.setAttribute('aria-label', 'Personal Bot suggestions')
      elements.content.appendChild(proposals)
    }
    const snapshot = JSON.stringify([status.proposals, status.proposalHiddenCount])
    if (snapshot !== proposalSnapshot) {
      proposalSnapshot = snapshot
      proposals.replaceChildren()
      if (!status.proposals.length) return
      const header = document.createElement('div')
      header.className = 'personal-bot-proposals-header'
      const heading = document.createElement('h2')
      heading.textContent = 'Personal Bot suggestions'
      header.append(heading, button('Close', close))
      proposals.append(header)
      if (status.proposalHiddenCount > 0) {
        const remaining = document.createElement('p')
        remaining.textContent = `${status.proposalHiddenCount} more suggestions in the agent store. Ask for suggestions to inspect them.`
        proposals.append(remaining)
      }
      for (const p of status.proposals) {
        const article = document.createElement('article')
        article.className = 'personal-bot-proposal'
        const state = document.createElement('p')
        state.className = 'personal-bot-proposal-state'
        state.textContent = `${p.ruleId} · ${p.status}`
        const advice = document.createElement('p')
        advice.textContent = p.advice
        article.append(state, advice)
        for (const e of p.evidence ?? []) {
          const evidence = document.createElement('p')
          evidence.className = 'personal-bot-proposal-evidence'
          evidence.textContent = `${e.readingId} · ${e.field}: ${JSON.stringify(e.value)} · ${p.status === 'expired' ? 'stale / expired' : e.state} · measured ${e.measuredAt}`
          article.append(evidence)
        }
        if (p.action) {
          const next = document.createElement('p')
          next.textContent = `Next: ${p.action.tool} ${JSON.stringify(p.action.params ?? {})}. Confirmation: ${p.confirmation}`
          article.append(next)
        }
        if (p.result) {
          const result = document.createElement('p')
          result.textContent = p.result
          article.append(result)
        }
        if (p.status === 'pending') {
          const actions = document.createElement('div')
          actions.className = 'personal-bot-proposal-actions'
          if (p.action && p.confirmation) actions.append(button('Accept', () => {
            actions.replaceChildren(button(p.confirmation, async () => {
              for (const control of actions.children) control.disabled = true
              await command({ type: 'proposal_respond', id: p.id, decision: 'accept', confirmation: p.confirmation })
            }), button('Cancel', () => { proposalSnapshot = ''; renderProposals(status) }))
          }))
          actions.append(button('Ignore', () => command({ type: 'proposal_respond', id: p.id, decision: 'ignore' })),
            button('Never suggest this category', () => command({ type: 'proposal_respond', id: p.id, decision: 'mute' })))
          article.append(actions)
        }
        proposals.append(article)
      }
    }
    if (status.proposalError) { proposalError = status.proposalError; showProposalError() }
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
    if (visible && !proactive) {
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
    if (surface.hidden || input === 'mic' || (proactive && !surface.contains(document.activeElement))) return false
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
      await window.odkPersonalBot.toggle()
    } catch {
      active = true
      render({ state: 'error', message: 'Unable to control recording', transcript: lastTranscript })
    } finally {
      togglePending = false
    }
  }
  window.odkPersonalBotStatus = { close, handleInput, mic, visible: () => !surface.hidden && !proactive }

  window.addEventListener('keydown', (event) => {
    if (surface.hidden || (proactive && !surface.contains(document.activeElement))) return
    if (proactive && event.key === 'Tab') return
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
    renderProposals(status)
    const idle = ['idle', 'error'].includes(status.state)
    const userSuggestions = status.proposalPopup && status.proposalInteraction && active && !dismissed && !proactive
    if (userSuggestions) {
      surface.dataset.suggestions = 'true'
      void command({ type: 'proposal_presented', ids: status.proposals.filter(p => p.status === 'pending').map(p => p.id) })
    }
    if (!idle) surface.dataset.suggestions = 'false'
    if (idle && !userSuggestions && (status.proposalPopup || (proactive && !surface.hidden))) {
      if (!proactive) setVisible(false)
      proactive = true
      surface.dataset.proactive = 'true'
      surface.setAttribute('aria-modal', 'false')
      if (status.proposalPopup) dismissed = false
      setVisible(!dismissed)
      if (!surface.hidden && status.proposalPopup && Array.isArray(status.proposals)) {
        void command({ type: 'proposal_presented', ids: status.proposals.filter(p => p.status === 'pending').map(p => p.id) })
      }
      return
    }
    if (proactive) setVisible(false)
    proactive = false
    surface.dataset.proactive = 'false'
    surface.setAttribute('aria-modal', 'true')
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
