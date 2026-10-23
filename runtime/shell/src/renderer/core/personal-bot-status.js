;(function () {
  'use strict'

  // Owner-channel protocol tokens are data, not interface copy.
  const rideQuotePrefix = '\u67e5\u770b\u62a5\u4ef7'
  const rideRefreshPrefix = '\u5237\u65b0\u884c\u7a0b'

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

  let proposals
  let proactive = false
  let proposalSnapshot = ''
  let proposalError = ''
  let proposalCommandError = ''
  let feedbackFocus
  let proposalEpoch = 0
  let suggestionCapabilities = { read: true, respond: true, acknowledge: true }
  // A transport receipt does not prove that the resident saved its visibility state.
  const visibilityAttempts = new Map()
  const visibleAdvice = new Set()
  const observedAdvice = new Map()
  let visibilityFailure = false
  function acknowledgeVisible(node, p) {
    if (!p || !visibleAdvice.has(node) || document.hidden || surface.hidden || visibilityFailure || !suggestionCapabilities.acknowledge ||
        p.status !== 'pending' || p.offered !== true || p.presented || p.snoozedUntil > Date.now()) return
    const prior = visibilityAttempts.get(p.id)
    if (prior && (prior.count >= 3 || Date.now() - prior.at < 5000)) return
    visibilityAttempts.set(p.id, { count: (prior?.count ?? 0) + 1, at: Date.now() })
    if (visibilityAttempts.size > 256) visibilityAttempts.delete(visibilityAttempts.keys().next().value)
    void command({ type: 'proposal_presented', ids: [p.id] })
  }
  const visibility = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      // Long advice can exceed the scroll viewport. Require meaningful visible body
      // area relative to the space a reader can actually see, not its whole length.
      const body = entry.boundingClientRect, viewport = entry.rootBounds
      const width = Math.min(body?.width ?? 0, viewport?.width ?? 0)
      const height = Math.min(body?.height ?? 0, viewport?.height ?? 0)
      if (!entry.isIntersecting || width <= 0 || height <= 0 || entry.intersectionRect.width < width * 0.5 || entry.intersectionRect.height < height * 0.5) {
        visibleAdvice.delete(entry.target); continue
      }
      visibleAdvice.add(entry.target)
      acknowledgeVisible(entry.target, observedAdvice.get(entry.target))
    }
  }, { root: elements.content, threshold: Array.from({ length: 101 }, (_, index) => index / 100) }) : null
  const recheckVisibility = () => {
    visibleAdvice.clear()
    if (!document.hidden) for (const node of observedAdvice.keys()) { visibility?.unobserve(node); visibility?.observe(node) }
  }
  document.addEventListener('visibilitychange', recheckVisibility)
  window.addEventListener('pagehide', () => { visibility?.disconnect(); observedAdvice.clear(); visibleAdvice.clear(); visibilityAttempts.clear(); expandedDisclosures.clear(); document.removeEventListener('visibilitychange', recheckVisibility) })

  async function command(value) {
    const epoch = proposalEpoch
    try {
      const receipt = await window.odkPersonalBot.proposalCommand(value)
      if (!receipt?.accepted) throw Error('Unavailable')
    } catch {
      if (epoch !== proposalEpoch) return
      if (value.type === 'proposal_presented') return
      proposalCommandError = 'Suggestion response was not delivered. Check the personal bot service; do not repeat an uncertain action.'
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
    error.textContent = proposalCommandError || proposalError
  }
  function button(label, callback) {
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = label
    node.addEventListener('click', callback)
    return node
  }
  function rideDetails(article, proposal, canRespond = true) {
    const preview = proposal.ridePreview
    if (!preview || typeof preview !== 'object') return
    const panel = document.createElement('section')
    panel.className = 'personal-bot-ride-details'
    panel.id = `ride-details-${proposal.id}`
    panel.setAttribute('aria-label', 'Ride details')
    panel.hidden = true
    const opening = button('View ride details', () => {
      panel.hidden = !panel.hidden
      opening.setAttribute('aria-expanded', String(!panel.hidden))
    })
    opening.setAttribute('aria-expanded', 'false')
    opening.setAttribute('aria-controls', panel.id)
    const note = document.createElement('p')
    const current = () => proposal.status === 'pending' && Number.isFinite(preview.expiresAt) && preview.expiresAt > Date.now()
    note.textContent = current() ? `Estimate observed ${preview.measuredAt}. Expires ${new Date(preview.expiresAt).toISOString()}. Planned pickup; current location is not verified. This preview has not placed an order.` : 'Ride preview is expired or needs a location. Ask the Agent to search again. This preview has not placed an order.'
    panel.append(note)
    if (preview.sandbox === true) { const sandbox = document.createElement('p'); sandbox.textContent = 'Sandbox preview; no real vehicle or trip.'; panel.append(sandbox) }
    for (const item of Array.isArray(preview.items) ? preview.items.slice(0, 16) : []) {
      const line = document.createElement('p')
      line.textContent = `${String(item.productName ?? '').slice(0, 256)}: ${String(item.priceText ?? '').slice(0, 256)}`
      panel.append(line)
    }
    const selectors = []
    for (const [key, caption] of [['from', 'Pickup'], ['to', 'Destination']]) {
      const label = document.createElement('label')
      label.textContent = caption
      const select = document.createElement('select')
      select.setAttribute('aria-label', caption)
      const choices = Array.isArray(preview[key]) ? preview[key].slice(0, 8) : []
      const blank = document.createElement('option')
      blank.value = ''; blank.textContent = `Choose ${caption.toLowerCase()}`
      select.append(blank)
      for (const place of choices) {
        const option = document.createElement('option')
        option.value = typeof place.handle === 'string' ? place.handle : ''
        option.textContent = `${String(place.name ?? '').slice(0, 256)} — ${String(place.city ?? '').slice(0, 80)} ${String(place.address ?? '').slice(0, 256)}`
        select.append(option)
      }
      select.value = choices.length === 1 ? choices[0].handle : ''
      label.append(select); panel.append(label); selectors.push(select)
    }
    if (canRespond && current()) panel.append(button('Get current quote', async function () {
      const handles = [preview.handle, ...selectors.map(select => select.value)]
      if (!current() || !handles.every(value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)) || !selectors.every((select, index) => preview[index === 0 ? 'from' : 'to'].some(p => p.handle === select.value))) {
        note.textContent = 'Choose both actual places. If the preview expired, ask the Agent to search again.'
        return
      }
      for (const control of [...selectors, quoteButton]) control.disabled = true
      try {
        const receipt = await window.odkPersonalBot.sendText(`${rideQuotePrefix} ${handles.join(' ')}`)
        if (!receipt?.accepted) throw Error('Unavailable')
      } catch {
        note.textContent = 'Quote request delivery is uncertain. Check the Agent conversation before trying again. No order confirmation was sent.'
      }
    }))
    const quoteButton = panel.children[panel.children.length - 1]
    if (canRespond && typeof preview.handle === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(preview.handle) && ['pending', 'expired'].includes(proposal.status)) {
      const refresh = button('Refresh preview', async () => {
        refresh.disabled = true
        try {
          const receipt = await window.odkPersonalBot.sendText(`${rideRefreshPrefix} ${preview.handle}`)
          if (!receipt?.accepted) throw Error('Unavailable')
        } catch { note.textContent = 'Preview refresh delivery is uncertain. Check the Agent conversation before trying again.' }
      })
      panel.append(refresh)
    }
    article.append(opening, panel)
  }
  const expandedDisclosures = new Set()
  function disclosure(label, className, id = '') {
    const details = document.createElement('details')
    details.className = className
    details.open = expandedDisclosures.has(id)
    details.addEventListener('toggle', () => {
      if (!id) return
      if (details.open) expandedDisclosures.add(id); else expandedDisclosures.delete(id)
      if (expandedDisclosures.size > 256) expandedDisclosures.delete(expandedDisclosures.values().next().value)
    })
    const summary = document.createElement('summary')
    summary.textContent = label
    if (id) { summary.dataset.proposalId = id; summary.dataset.proposalAction = 'disclosure' }
    details.append(summary)
    return details
  }
  function renderProposals(status) {
    if (status.state === 'unavailable' || status.proposalCapabilities?.read === false) {
      proposalEpoch++
      visibility?.disconnect(); observedAdvice.clear(); visibleAdvice.clear(); visibilityAttempts.clear(); proposalSnapshot = ''
      suggestionCapabilities = { read: false, respond: false, acknowledge: false }
      proposalError = ''; proposalCommandError = ''; visibilityFailure = false; feedbackFocus = undefined
      expandedDisclosures.clear()
      if (proposals) { proposals.replaceChildren(); proposals.hidden = true }
      return
    }
    if (!Array.isArray(status.proposals)) return
    if (visibilityFailure && !status.proposalError) visibilityAttempts.clear()
    visibilityFailure = Boolean(status.proposalError)
    suggestionCapabilities = status.proposalCapabilities === undefined ? { read: true, respond: true, acknowledge: true } : {
      read: status.proposalCapabilities?.read === true,
      respond: status.proposalCapabilities?.respond === true,
      acknowledge: status.proposalCapabilities?.acknowledge === true,
    }
    if (!proposals) {
      if (!status.proposals.length) return
      proposals = document.createElement('section')
      proposals.className = 'personal-bot-proposals'
      proposals.setAttribute('aria-label', 'Personal Bot suggestions')
      elements.content.appendChild(proposals)
    }
    proposals.hidden = !status.proposals.length || !suggestionCapabilities.read
    const snapshot = JSON.stringify([status.proposals, status.proposalHiddenCount, suggestionCapabilities])
    if (snapshot !== proposalSnapshot) {
      proposalSnapshot = snapshot
      const focused = document.activeElement
      const retainedFocus = focused === document.body ? feedbackFocus : undefined
      const focusId = focused?.dataset?.proposalId || retainedFocus?.id, focusAction = focused?.dataset?.proposalAction || retainedFocus?.action
      feedbackFocus = undefined
      const previousScroll = elements.content.scrollTop
      visibility?.disconnect(); observedAdvice.clear(); visibleAdvice.clear()
      proposals.replaceChildren()
      proposalCommandError = ''
      if (!status.proposals.length || !suggestionCapabilities.read) { proposalError = status.proposalError || ''; return }
      const header = document.createElement('div')
      header.className = 'personal-bot-proposals-header'
      const heading = document.createElement('h2')
      heading.textContent = 'Personal Bot suggestions'
      header.append(heading, button('Close', close))
      proposals.append(header)
      if (!suggestionCapabilities.respond) {
        const note = document.createElement('p')
        note.className = 'personal-bot-proposal-capability'
        note.textContent = 'Suggestions are read-only on this device. Respond from the desk.'
        proposals.append(note)
      }
      if (status.proposalHiddenCount > 0) {
        const remaining = document.createElement('p')
        remaining.textContent = `${status.proposalHiddenCount} more suggestions in the agent store. Ask for suggestions to inspect them.`
        proposals.append(remaining)
      }
      const history = disclosure('Previous suggestions', 'personal-bot-proposal-history', 'history')
      const statusLabels = { pending: 'Suggested', ignored: 'Dismissed', expired: 'Expired', executing: 'In progress', completed: 'Completed', unknown: 'Outcome not confirmed' }
      const feedbackLabels = { done: 'Marked done', snooze: 'Saved for later', useful: 'Marked useful', irrelevant: 'Marked not relevant', incorrect: 'Marked incorrect' }
      let historical = 0
      for (const p of status.proposals) {
        if (!p || typeof p.advice !== 'string') continue
        const snoozed = p.status === 'pending' && p.snoozedUntil > Date.now()
        const current = p.status === 'pending' && !snoozed
        const article = document.createElement('article')
        article.className = 'personal-bot-proposal'
        article.dataset.proposalId = p.id
        const state = document.createElement('p')
        state.className = 'personal-bot-proposal-state'
        state.textContent = snoozed ? 'Saved for later' : statusLabels[p.status] || 'Suggestion state unavailable'
        const advice = document.createElement('p')
        advice.className = 'personal-bot-proposal-advice'
        advice.textContent = p.advice
        article.append(state, advice)
        if (typeof p.reason === 'string' && p.reason.trim()) {
          const reason = document.createElement('p')
          reason.className = 'personal-bot-proposal-reason'
          reason.textContent = `Why now: ${p.reason}`
          article.append(reason)
        }
        if (p.feedback && feedbackLabels[p.feedback]) {
          const feedback = document.createElement('p')
          feedback.className = 'personal-bot-proposal-feedback'
          feedback.setAttribute('role', 'status')
          feedback.textContent = feedbackLabels[p.feedback]
          article.append(feedback)
        }
        const sources = disclosure('Sources and details', 'personal-bot-proposal-sources', `${p.id}:sources`)
        const identity = document.createElement('p')
        identity.className = 'personal-bot-proposal-evidence'
        identity.textContent = `${p.ruleId} · ${p.status}`
        sources.append(identity)
        for (const e of p.evidence ?? []) {
          const evidence = document.createElement('p')
          evidence.className = 'personal-bot-proposal-evidence'
          evidence.textContent = `${e.readingId} · ${e.field}: ${JSON.stringify(e.value)} · ${p.status === 'expired' ? 'stale / expired' : e.state} · measured ${e.measuredAt}`
          sources.append(evidence)
        }
        if (p.action && suggestionCapabilities.respond) {
          const next = document.createElement('p')
          next.textContent = `Next: ${p.action.tool} ${JSON.stringify(p.action.params ?? {})}. Confirmation: ${p.confirmation}`
          sources.append(next)
        }
        article.append(sources)
        if (p.ridePreview) rideDetails(article, p, suggestionCapabilities.respond)
        if (p.result) {
          const result = document.createElement('p')
          result.textContent = p.result
          result.setAttribute('role', 'status')
          article.append(result)
        }
        if (current && suggestionCapabilities.respond) {
          const actions = document.createElement('div')
          actions.className = 'personal-bot-proposal-actions'
          const response = (label, decision) => {
            const control = button(label, async () => {
              if (document.activeElement === control) feedbackFocus = { id: p.id, action: decision }
              control.disabled = true
              await command({ type: 'proposal_respond', id: p.id, decision })
            })
            control.dataset.proposalId = p.id; control.dataset.proposalAction = decision
            return control
          }
          if (p.action && p.confirmation) actions.append(button('Accept', () => {
            actions.replaceChildren(button(p.confirmation, async () => {
              for (const control of actions.children) control.disabled = true
              await command({ type: 'proposal_respond', id: p.id, decision: 'accept', confirmation: p.confirmation })
            }), button('Cancel', () => { proposalSnapshot = ''; renderProposals(status) }))
          }))
          if (!p.action) actions.append(response('Done', 'done'), response('Later', 'snooze'))
          const feedback = disclosure('Feedback', 'personal-bot-proposal-feedback-options', `${p.id}:feedback`)
          const choices = document.createElement('div')
          choices.className = 'personal-bot-proposal-actions'
          if (!p.action) choices.append(response('Useful', 'useful'), response('Not relevant', 'irrelevant'), response('Incorrect', 'incorrect'))
          choices.append(response('Ignore', 'ignore'), response('Never suggest this category', 'mute'))
          feedback.append(choices)
          article.append(actions, feedback)
        }
        if (current) {
          proposals.append(article)
          observedAdvice.set(advice, p)
          visibility?.observe(advice)
        } else { history.append(article); historical++ }
      }
      if (historical) {
        history.children[0].textContent = `Previous suggestions (${historical})`
        proposals.append(history)
      }
      if (focusId && focusAction) {
        let restored = false
        for (const node of proposals.querySelectorAll?.('button, summary') || []) if (node.dataset.proposalId === focusId && node.dataset.proposalAction === focusAction) {
          const owner = node.closest('details'); if (owner && node.tagName !== 'SUMMARY') owner.open = true
          node.focus({ preventScroll: true }); restored = true; break
        }
        if (!restored) proposals.querySelector('.personal-bot-proposals-header button')?.focus({ preventScroll: true })
      }
      elements.content.scrollTop = previousScroll
    }
    for (const [node, p] of observedAdvice) acknowledgeVisible(node, p)
    proposalError = status.proposalError || ''
    if (proposalError || proposalCommandError) showProposalError()
    else proposals.querySelector('.personal-bot-proposal-error')?.remove()
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
    if (residentHome() && !proactive) visible = false
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
  window.odkPersonalBotStatus = { close, handleInput, mic, visible: () => !surface.hidden && !proactive }

  window.addEventListener('keydown', (event) => {
    if (surface.hidden || (proactive && !surface.contains(document.activeElement))) return
    if ((proactive || surface.dataset.suggestions === 'true') && event.key === 'Tab') return
    if (event.key !== 'Escape' && document.activeElement?.closest?.('.personal-bot-proposals') && document.activeElement !== elements.content) { event.stopImmediatePropagation(); return }
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
    const hasSuggestions = suggestionCapabilities.read && Boolean(proposals?.children.length)
    const userSuggestions = hasSuggestions && status.proposalPopup && status.proposalInteraction && active && !dismissed && !proactive
    if (userSuggestions) {
      surface.dataset.suggestions = 'true'
    }
    if (!idle) surface.dataset.suggestions = 'false'
    if (idle && hasSuggestions && !userSuggestions && (status.proposalPopup || (proactive && !surface.hidden))) {
      if (!proactive) setVisible(false)
      proactive = true
      surface.dataset.proactive = 'true'
      surface.setAttribute('aria-modal', 'false')
      if (status.proposalPopup) dismissed = false
      setVisible(!dismissed)
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
