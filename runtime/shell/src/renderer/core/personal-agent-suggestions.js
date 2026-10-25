;(function (root) {
  'use strict'

  // Reservations survive page replacement until the resident reports an outcome.
  const executionAttempts = new Map()
  const rideRequests = new Map()

  // Mounted by the selected Personal Agent page; this helper owns no popup.
  root.odkPersonalAgentSuggestions = {
    mount(surface, { api = root.odkPersonalAgent ?? {}, focusInput = () => {} } = {}) {
      const elements = { content: surface }
      const rideQuotePrefix = '\u67e5\u770b\u62a5\u4ef7'
      const rideRefreshPrefix = '\u5237\u65b0\u884c\u7a0b'
      let closed = false
      let consumerUnavailable = false
      let consumerId
      let proposals
      let proposalSnapshot = ''
      let proposalError = ''
      let proposalCommandError = ''
      // Keep dispatched operations reserved until this ID has an authoritative terminal state.
      const actionConfirmations = new Map()
      const rideStatusNodes = new Map()
      function releaseRideViews() {
        for (const { requests, node } of rideStatusNodes.values()) if (requests?.view === node) delete requests.view
        rideStatusNodes.clear()
      }
      const renderedProposalIds = new Set()
      const uncertainActionWarning = 'Suggestion response was not delivered. Check the personal agent service; do not repeat an uncertain action.'
      let feedbackFocus
      let proposalEpoch = 0
      let suggestionCapabilities = { read: true, respond: true, acknowledge: true }
      // A transport receipt does not prove that the resident saved its visibility state.
      const visibilityAttempts = new Map()
      const visibleAdvice = new Set()
      const observedAdvice = new Map()
      let visibilityFailure = false
      function acknowledgeVisible(node, p) {
        if (closed || !p || !visibleAdvice.has(node) || node.checkVisibility?.() === false || document.hidden || surface.hidden || visibilityFailure || !suggestionCapabilities.acknowledge ||
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


      async function command(value) {
        const epoch = proposalEpoch
        const executionAttempt = value.type === 'proposal_respond' && value.decision === 'accept' ? executionAttempts.get(value.id) : undefined
        try {
          const receipt = await api.proposalCommand(value)
          if (!receipt?.accepted) throw Error('Unavailable')
        } catch {
          if (executionAttempt) {
            if (executionAttempts.get(value.id) !== executionAttempt) return
            executionAttempt.uncertain = true
          }
          if (closed) return
          if (epoch !== proposalEpoch && (!executionAttempt || !renderedProposalIds.has(value.id))) return
          if (value.type === 'proposal_presented') return
          proposalCommandError = uncertainActionWarning
          showProposalError()
        }
      }
      function showProposalError() {
        let error = proposals.querySelector('.personal-agent-proposal-error')
        if (!error) {
          error = document.createElement('p')
          error.className = 'personal-agent-proposal-error'
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
      function rideRoute(article, proposal, canRespond = true) {
        const preview = proposal.ridePreview
        if (!preview || typeof preview !== 'object') return
        let requests = rideRequests.get(proposal.id)
        if (requests?.handle !== preview.handle) {
          requests = { handle: preview.handle, quote: false, refresh: false }
          rideRequests.set(proposal.id, requests)
        }
        const panel = document.createElement('section')
        panel.className = 'personal-agent-ride-route'
        panel.id = `ride-route-${proposal.id}`
        panel.setAttribute('aria-label', 'Ride route')
        panel.hidden = true
        const note = document.createElement('p')
        const current = () => proposal.status === 'pending' && Number.isFinite(preview.expiresAt) && preview.expiresAt > Date.now()
        note.textContent = current() ? 'Planned pickup; current location is not verified. No order placed.' : 'Estimate expired. Refresh to check the route again. No order placed.'
        article.append(note)
        if (preview.sandbox === true) { const sandbox = document.createElement('p'); sandbox.textContent = 'Sandbox preview; no real vehicle or trip.'; article.append(sandbox) }
        for (const item of Array.isArray(preview.items) ? preview.items.slice(0, 16) : []) {
          const line = document.createElement('p')
          line.textContent = `${String(item.productName ?? '').slice(0, 256)}: ${String(item.priceText ?? '').slice(0, 256)}`
          article.append(line)
        }
        const selectors = []
        const route = document.createElement('p')
        route.textContent = [preview.from, preview.to].map(places => Array.isArray(places) && places.length === 1 ? String(places[0].name ?? '').slice(0, 256) : 'Choose a place').join(' → ')
        article.append(route)
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
        const actions = document.createElement('div')
        actions.className = 'personal-agent-proposal-actions personal-agent-ride-actions'
        const requestStatus = document.createElement('p')
        requestStatus.className = 'personal-agent-proposal-request-status'
        requestStatus.setAttribute('role', 'status')
        requestStatus.textContent = requests?.message ?? ''
        rideStatusNodes.set(proposal.id, { requests, node: requestStatus })
        if (requests) requests.view = requestStatus
        const showRequestStatus = text => {
          requests.message = text
          if (requests.view) requests.view.textContent = text
        }
        let quoteButton
        const validPreviewHandle = typeof preview.handle === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(preview.handle)
        if (canRespond && validPreviewHandle && current()) {
          quoteButton = button('Get current quote', async function () {
            if (closed || !surface.contains(quoteButton) || quoteButton.disabled || requests.quote) return
            const handles = [preview.handle, ...selectors.map(select => select.value)]
            if (!current() || !handles.every(value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)) || !selectors.every((select, index) => preview[index === 0 ? 'from' : 'to'].some(p => p.handle === select.value))) {
              note.textContent = 'Choose both actual places. If the preview expired, ask the Agent to search again.'
              panel.hidden = false
              const missing = selectors.find(select => !select.value)
              if (missing) missing.focus()
              return
            }
            requests.quote = true
            for (const control of [...selectors, quoteButton]) control.disabled = true
            showRequestStatus('Sending quote request…')
            try {
              const receipt = await api.sendText(`${rideQuotePrefix} ${handles.join(' ')}`)
              if (!receipt?.accepted) throw Error('Unavailable')
              showRequestStatus('Quote request sent. Follow its result in the Agent conversation.')
            } catch {
              showRequestStatus('Quote request delivery is uncertain. Check the Agent conversation before trying again. No order confirmation was sent.')
            }
          })
          quoteButton.className = 'personal-agent-proposal-primary'
          quoteButton.disabled = requests.quote
          quoteButton.dataset.proposalId = proposal.id
          quoteButton.dataset.proposalAction = 'ride-quote'
          actions.append(quoteButton)
        }
        if (canRespond && validPreviewHandle && ['pending', 'expired'].includes(proposal.status)) {
          const refresh = button('Refresh preview', async () => {
            if (closed || !surface.contains(refresh) || refresh.disabled || requests.refresh) return
            requests.refresh = true
            refresh.disabled = true
            showRequestStatus('Sending preview refresh…')
            try {
              const receipt = await api.sendText(`${rideRefreshPrefix} ${preview.handle}`)
              if (!receipt?.accepted) throw Error('Unavailable')
              showRequestStatus('Preview refresh sent. Follow its result in the Agent conversation.')
            } catch { showRequestStatus('Preview refresh delivery is uncertain. Check the Agent conversation before trying again.') }
          })
          refresh.dataset.proposalId = proposal.id
          refresh.disabled = requests.refresh
          refresh.dataset.proposalAction = 'ride-refresh'
          if (!quoteButton) refresh.className = 'personal-agent-proposal-primary'
          else panel.append(refresh)
          if (!quoteButton) actions.append(refresh)
        }
        article.append(actions, requestStatus, panel)
        return actions.children.length > 0
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
          renderedProposalIds.clear()
          visibility?.disconnect(); observedAdvice.clear(); visibleAdvice.clear(); visibilityAttempts.clear(); proposalSnapshot = ''
          suggestionCapabilities = { read: false, respond: false, acknowledge: false }
          proposalError = ''; proposalCommandError = ''; visibilityFailure = false; feedbackFocus = undefined
          expandedDisclosures.clear()
          actionConfirmations.clear()
          if (proposals) { proposals.replaceChildren(); proposals.hidden = true }
          return
        }
        if (!Array.isArray(status.proposals)) return
        renderedProposalIds.clear()
        for (const p of status.proposals) if (p?.id) renderedProposalIds.add(p.id)
        for (const p of status.proposals) if (p && ['completed', 'unknown', 'ignored', 'expired'].includes(p.status)) executionAttempts.delete(p.id)
        const uncertainExecution = status.proposals.some(p => p && executionAttempts.get(p.id)?.uncertain)
        if (visibilityFailure && !status.proposalError) visibilityAttempts.clear()
        visibilityFailure = Boolean(status.proposalError)
        const commandsAvailable = typeof api.proposalCommand === 'function'
        suggestionCapabilities = status.proposalCapabilities === undefined ? { read: true, respond: commandsAvailable, acknowledge: commandsAvailable } : {
          read: status.proposalCapabilities?.read === true,
          respond: status.proposalCapabilities?.respond === true && commandsAvailable,
          acknowledge: status.proposalCapabilities?.acknowledge === true && commandsAvailable,
        }
        const actionSignature = p => JSON.stringify([p.actionId, p.action, p.confirmation, p.nextStep])
        for (const [id, confirmation] of actionConfirmations) {
          const p = status.proposals.find(proposal => proposal?.id === id)
          if (!suggestionCapabilities.respond || !p?.action || p.status !== 'pending' || p.snoozedUntil > Date.now() || executionAttempts.has(id) || actionSignature(p) !== confirmation.signature) actionConfirmations.delete(id)
        }
        if (!proposals) {
          if (!status.proposals.length) return
          proposals = document.createElement('section')
          proposals.className = 'personal-agent-proposals'
          proposals.setAttribute('aria-label', 'Suggestions')
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
          releaseRideViews()
          proposals.replaceChildren()
          proposalCommandError = uncertainExecution ? uncertainActionWarning : ''
          if (!status.proposals.length || !suggestionCapabilities.read) { proposalError = status.proposalError || ''; return }
          const header = document.createElement('div')
          header.className = 'personal-agent-proposals-header'
          const heading = document.createElement('h2')
          heading.textContent = 'Suggestions'
          header.append(heading)
          proposals.append(header)
          if (!suggestionCapabilities.respond) {
            const note = document.createElement('p')
            note.className = 'personal-agent-proposal-capability'
            note.textContent = 'Suggestions are read-only on this device. Respond from the desk.'
            proposals.append(note)
          }
          if (status.proposalHiddenCount > 0) {
            const remaining = document.createElement('p')
            remaining.textContent = `${status.proposalHiddenCount} more suggestions in the agent store. Ask for suggestions to inspect them.`
            proposals.append(remaining)
          }
          const history = disclosure('Previous suggestions', 'personal-agent-proposal-history', 'history')
          const statusLabels = { pending: 'Suggested', ignored: 'Dismissed', expired: 'Expired', executing: 'In progress', completed: 'Completed', unknown: 'Outcome not confirmed' }
          const feedbackLabels = { done: 'Marked done', snooze: 'Saved for later', useful: 'Marked useful', irrelevant: 'Marked not relevant', incorrect: 'Marked incorrect' }
          let historical = 0
          for (const p of status.proposals) {
            if (!p || typeof p.advice !== 'string') continue
            const snoozed = p.status === 'pending' && p.snoozedUntil > Date.now()
            const current = p.status === 'pending' && !snoozed
            const article = document.createElement('article')
            article.className = 'personal-agent-proposal'
            article.dataset.proposalId = p.id
            const state = document.createElement('p')
            state.className = 'personal-agent-proposal-state'
            state.textContent = snoozed ? 'Saved for later' : statusLabels[p.status] || 'Suggestion state unavailable'
            const advice = document.createElement('p')
            advice.className = 'personal-agent-proposal-advice'
            const technicalText = /sha[-_\s]?256|\b[a-f0-9]{32,}\b/i
            const technicalAdvice = technicalText.test(p.advice)
            const technicalNext = typeof p.nextStep === 'string' && technicalText.test(p.nextStep)
            const executableAction = Boolean(p.action && typeof p.confirmation === 'string' && p.confirmation.trim())
            const nextStep = typeof p.nextStep === 'string' && p.nextStep.length <= 240 && !/[\x00-\x1f\x7f]/.test(p.nextStep) && !technicalNext ? p.nextStep.trim() : ''
            const readOnlyStep = !suggestionCapabilities.respond && Boolean(nextStep)
            if (!executableAction) state.textContent += p.ridePreview || readOnlyStep ? ' · Read-only preview' : ' · Earlier suggestion · No executable action'
            else if (!nextStep || technicalAdvice) state.textContent += ' · Earlier suggestion'
            advice.textContent = technicalAdvice ? 'Earlier recommendation unavailable. Ask the Agent for an updated suggestion.' : p.advice
            if (!technicalAdvice && p.advice.length > 180) {
              advice.dataset.long = 'true'
              advice.setAttribute('tabindex', '0')
              advice.setAttribute('role', 'region')
              advice.setAttribute('aria-label', 'Full recommendation; scroll to read')
              advice.addEventListener('keydown', event => {
                if (event.target !== advice || !['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
                // Keep the focused region's scroll keys out of the Shell pager.
                event.stopPropagation()
                if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return
                if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault()
                  advice.scrollTop = event.key === 'Home' ? 0 : advice.scrollHeight
                }
              })
            }
            article.append(state, advice)
            if ((readOnlyStep || (executableAction && !current)) && nextStep && !technicalAdvice) {
              const next = document.createElement('div')
              next.className = 'personal-agent-proposal-next'
              const caption = document.createElement('p')
              caption.className = 'personal-agent-proposal-next-label'
              caption.textContent = 'Next step'
              const step = document.createElement('p')
              step.className = 'personal-agent-proposal-next-step'
              step.textContent = nextStep
              next.append(caption, step)
              article.append(next)
            }
            if (current && executionAttempts.has(p.id)) {
              const pending = document.createElement('p')
              pending.className = 'personal-agent-proposal-feedback'
              pending.setAttribute('role', 'status')
              pending.textContent = 'Operation submitted; waiting for its confirmed outcome. Do not repeat this action.'
              article.append(pending)
            }
            if (p.feedback && feedbackLabels[p.feedback]) {
              const feedback = document.createElement('p')
              feedback.className = 'personal-agent-proposal-feedback'
              feedback.setAttribute('role', 'status')
              feedback.textContent = feedbackLabels[p.feedback]
              article.append(feedback)
            }
            const memoryStates = {
              queued: 'Feedback saved. Updating related memory…',
              running: 'Feedback saved. Updating related memory…',
              applied: 'Feedback saved. Related memory updated.',
              failed: 'Feedback saved. Memory update unavailable.',
              unavailable: 'Feedback saved. Memory update unavailable.',
              stale: 'Feedback saved. Memory update was skipped.',
            }
            if (p.feedbackLearning && Object.hasOwn(memoryStates, p.feedbackLearning.status)) {
              const memory = document.createElement('p')
              memory.className = 'personal-agent-proposal-memory personal-agent-proposal-feedback'
              memory.setAttribute('role', 'status')
              memory.textContent = memoryStates[p.feedbackLearning.status]
              article.append(memory)
            }
            if (p.ridePreview) rideRoute(article, p, suggestionCapabilities.respond && typeof api.sendText === 'function')
            if (p.result) {
              let structuredResult = false
              if (typeof p.result === 'string' && p.result.length <= 8192) {
                try {
                  const parsed = JSON.parse(p.result)
                  structuredResult = parsed !== null && typeof parsed === 'object'
                } catch { /* Human-readable operation results are not JSON receipts. */ }
              }
              const result = document.createElement('p')
              result.textContent = p.result
              result.setAttribute('role', 'status')
              if (technicalText.test(p.result) || structuredResult) {
                result.textContent = 'Operation result recorded. Check its status in the Agent conversation.'
                article.append(result)
              } else article.append(result)
            }
            if (current && suggestionCapabilities.respond) {
              const actions = document.createElement('div')
              actions.className = 'personal-agent-proposal-actions'
              const response = (label, decision) => {
                const control = button(label, async () => {
                  if (closed || control.disabled || !surface.contains(control) || !suggestionCapabilities.respond) return
                  if (document.activeElement === control) feedbackFocus = { id: p.id, action: decision }
                  control.disabled = true
                  await command({ type: 'proposal_respond', id: p.id, decision })
                })
                control.dataset.proposalId = p.id; control.dataset.proposalAction = decision
                return control
              }
              if (executableAction) {
                const showConfirmation = (confirmation, focus = false) => {
                  const isCurrent = () => !closed && surface.contains(actions) && proposals.contains(actions) && suggestionCapabilities.respond && actionConfirmations.get(p.id) === confirmation && !executionAttempts.has(p.id)
                  const confirm = button(p.confirmation, async () => {
                    if (!isCurrent()) return
                    actionConfirmations.delete(p.id)
                    executionAttempts.set(p.id, { uncertain: false })
                    for (const control of actions.children) control.disabled = true
                    await command({ type: 'proposal_respond', id: p.id, decision: 'accept', confirmation: p.confirmation })
                  })
                  confirm.className = 'personal-agent-proposal-primary'
                  confirm.dataset.proposalId = p.id; confirm.dataset.proposalAction = 'confirm'
                  const cancel = button('Cancel', () => {
                    if (!isCurrent()) return
                    actionConfirmations.delete(p.id)
                    proposalSnapshot = ''; renderProposals(status)
                    for (const card of proposals.children) if (card.dataset.proposalId === p.id) card.querySelector('[data-proposal-action="execute"]')?.focus({ preventScroll: true })
                  })
                  cancel.className = 'personal-agent-proposal-secondary'
                  cancel.dataset.proposalId = p.id; cancel.dataset.proposalAction = 'cancel'
                  actions.replaceChildren(confirm, cancel)
                  if (focus && proposals.contains(confirm)) confirm.focus({ preventScroll: true })
                }
                const confirmation = actionConfirmations.get(p.id)
                if (confirmation) showConfirmation(confirmation)
                else {
                  const accept = button(nextStep && !technicalAdvice ? nextStep : 'Run action', () => {
                    if (closed || !surface.contains(accept) || !proposals.contains(accept) || !suggestionCapabilities.respond || executionAttempts.has(p.id)) return
                    const confirmation = { signature: actionSignature(p) }
                    actionConfirmations.set(p.id, confirmation)
                    showConfirmation(confirmation, true)
                  })
                  accept.className = 'personal-agent-proposal-primary'
                  accept.dataset.proposalId = p.id; accept.dataset.proposalAction = 'execute'
                  accept.disabled = executionAttempts.has(p.id)
                  const later = response('Later', 'snooze')
                  later.className = 'personal-agent-proposal-secondary'
                  later.disabled = accept.disabled
                  actions.append(accept, later)
                }
              }
              const feedback = disclosure('Feedback', 'personal-agent-proposal-feedback-options', `${p.id}:feedback`)
              const choices = document.createElement('div')
              choices.className = 'personal-agent-proposal-actions'
              if (!p.action) choices.append(response('Done', 'done'), response('Later', 'snooze'))
              choices.append(response('Useful', 'useful'), response('Not relevant', 'irrelevant'), response('Incorrect', 'incorrect'))
              choices.append(response('Ignore', 'ignore'), response('Never suggest this category', 'mute'))
              feedback.append(choices)
              article.append(actions, feedback)
            }
            if (current) {
              proposals.append(article)
              if (!technicalAdvice) { observedAdvice.set(advice, p); visibility?.observe(advice) }
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
            if (!restored) focusInput()
          }
          elements.content.scrollTop = previousScroll
        }
        for (const [node, p] of observedAdvice) acknowledgeVisible(node, p)
        proposalError = status.proposalError || ''
        if (proposalError || proposalCommandError) showProposalError()
        else proposals.querySelector('.personal-agent-proposal-error')?.remove()
      }

      function consumerReady() {
        if (closed || document.visibilityState === 'hidden' || typeof api.consumerReady !== 'function' || !globalThis.crypto?.randomUUID) return
        void announceConsumer(consumerId ||= globalThis.crypto.randomUUID())
      }
      function announceConsumer(id) {
        try { return Promise.resolve(api.consumerReady?.(id)).catch(() => {}) }
        catch { return Promise.resolve() }
      }
      function consumerVisibilityChanged() {
        if (document.visibilityState === 'hidden') {
          consumerId = undefined
          void announceConsumer(null)
        }
        else consumerReady()
      }
      document.addEventListener('visibilitychange', consumerVisibilityChanged)

      consumerReady()
      return {
        update(status) {
          if (closed) return
          const unavailable = status.state === 'unavailable' || status.proposalCapabilities?.read === false
          if (status.proposalCapabilities?.read === false) consumerId = undefined
          const restored = consumerUnavailable && !unavailable
          consumerUnavailable = unavailable
          renderProposals(status)
          surface.hidden = !proposals || proposals.hidden || !proposals.children.length
          if (restored) consumerReady()
        },
        async destroy() {
          if (closed) return
          closed = true
          proposalEpoch++
          actionConfirmations.clear()
          renderedProposalIds.clear()
          releaseRideViews()
          visibility?.disconnect()
          observedAdvice.clear(); visibleAdvice.clear(); visibilityAttempts.clear()
          document.removeEventListener('visibilitychange', recheckVisibility)
          document.removeEventListener('visibilitychange', consumerVisibilityChanged)
          surface.replaceChildren(); surface.hidden = true
          await announceConsumer(null)
        },
      }
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
