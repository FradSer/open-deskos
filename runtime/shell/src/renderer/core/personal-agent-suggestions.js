;(function (root) {
  'use strict'

  // Reservations survive page replacement until the resident reports an outcome.
  const executionAttempts = new Map()
  const rideRequests = new Map()
  const rendererWaiters = new Set()
  const globalDocument = typeof document !== 'undefined' ? document : null
  const rendererScriptBase = globalDocument?.currentScript?.src ?? ''
  let rendererScriptRequested = false

  function currentRenderer() {
    const api = root.odkOpenUIDOM ?? root.odkOpenUI ?? (typeof globalThis === 'object' ? globalThis.odkOpenUIDOM : undefined)
    if (typeof api?.renderOpenUI === 'function' && typeof api?.isOpenUINode === 'function') return api
    if (typeof module === 'object' && typeof require === 'function') {
      try {
        const loaded = require('./openui-dom.js')
        if (typeof loaded?.renderOpenUI === 'function' && typeof loaded?.isOpenUINode === 'function') {
          root.odkOpenUIDOM ||= loaded
          return loaded
        }
      } catch { /* The browser loads the renderer as a classic script. */ }
    }
    return null
  }

  function notifyRendererReady() {
    const api = currentRenderer()
    if (!api) return
    for (const waiter of [...rendererWaiters]) {
      rendererWaiters.delete(waiter)
      try { waiter(api) } catch { /* One mounted surface cannot block another. */ }
    }
  }
  if (typeof root.addEventListener === 'function') root.addEventListener('odk-openui-dom-ready', notifyRendererReady)

  function requestRenderer(onReady) {
    const api = currentRenderer()
    if (api) return api
    if (typeof onReady === 'function') rendererWaiters.add(onReady)
    if (!rendererScriptRequested) {
      const doc = root.document ?? globalDocument
      const head = doc?.head ?? (typeof doc?.querySelector === 'function' ? doc.querySelector('head') : null)
      if (doc && typeof doc.createElement === 'function' && head && typeof head.appendChild === 'function') {
        const script = doc.createElement('script')
        const current = rendererScriptBase || (typeof doc.baseURI === 'string' ? doc.baseURI : '')
        const relative = rendererScriptBase ? 'openui-dom.js' : 'core/openui-dom.js'
        const URLImpl = root.URL ?? (typeof URL === 'function' ? URL : null)
        if (script && typeof script.addEventListener === 'function') {
          try { script.src = current && URLImpl ? new URLImpl(relative, current).href : relative } catch { script.src = relative }
          script.async = false
          script.addEventListener('load', notifyRendererReady)
          script.addEventListener('error', () => { rendererScriptRequested = false })
          try { head.appendChild(script); rendererScriptRequested = true } catch { /* The host may already load the script. */ }
        }
      }
    }
    return null
  }

  // Stored records keep their old summary/items/place shape. Convert them to the
  // same generic component tree; the component renderer owns all DOM output.
  // A stored summary that restates the advice is redundant: the bubble already
  // draws that sentence. Only a distinct route/place line earns a card Heading.
  function distinctSummary(summary, advice) {
    const text = typeof summary === 'string' ? summary.trim() : ''
    if (!text) return ''
    const normalize = value => value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase()
    const line = normalize(text), sentence = normalize(typeof advice === 'string' ? advice : '')
    if (line.length >= 4 && sentence.length >= 4 && (line === sentence || sentence.includes(line) || line.includes(sentence))) return ''
    return text
  }
  function legacyPlaceLabel(place) {
    if (!place || typeof place !== 'object') return ''
    return [place.name, place.city, place.address].filter(value => typeof value === 'string' && value.trim()).join(' — ')
  }
  function legacyOptionSet(key, places) {
    if (!Array.isArray(places) || !places.length) return null
    return {
      type: 'OptionSet',
      props: {
        label: key === 'from' ? 'From' : 'To',
        children: places.slice(0, 8).map(place => ({
          type: 'Option',
          props: { label: legacyPlaceLabel(place), value: typeof place?.handle === 'string' ? place.handle : '' },
        })),
      },
    }
  }
  function legacyPreviewUI(proposal) {
    const preview = proposal.preview || proposal.ridePreview
    if (!preview || typeof preview !== 'object') return null
    const children = []
    let summary = distinctSummary(preview.summary, proposal.advice)
    if (!summary && Array.isArray(preview.from) && Array.isArray(preview.to) && preview.from.length === 1 && preview.to.length === 1) {
      const from = legacyPlaceLabel(preview.from[0]), to = legacyPlaceLabel(preview.to[0])
      if (from && to) summary = distinctSummary(`${from} → ${to}`, proposal.advice)
    }
    if (summary) children.push({ type: 'Heading', props: { value: summary } })
    for (const item of Array.isArray(preview.items) ? preview.items.slice(0, 3) : []) {
      if (!item || typeof item !== 'object') continue
      const label = item.label ?? item.productName ?? item.name ?? ''
      const value = item.value ?? item.priceText ?? item.text ?? ''
      const tone = ['warn', 'good', 'neutral'].includes(item.tone) ? item.tone : undefined
      if (!label && !value) continue
      children.push({ type: 'Reading', props: { label, value, ...(tone ? { tone } : {}) } })
    }
    for (const key of ['from', 'to']) {
      const options = legacyOptionSet(key, preview[key])
      if (options) children.push(options)
    }
    return children.length ? { type: 'Suggestion', props: { children } } : null
  }

  // Stored Intent previews have no OpenUI tree. Their historical controller is
  // kept only until a stored record is replaced by a generated candidate.
  function storedRidePreview(proposal) {
    const candidate = proposal.ridePreview ?? (proposal.preview && typeof proposal.preview.handle === 'string' ? proposal.preview : null)
    return candidate && typeof candidate === 'object' ? candidate : null
  }

  // The conversation owns placement; the resident owns proposal state and authority.
  root.odkPersonalAgentSuggestions = {
    mount(surface, { api = root.odkPersonalAgent ?? {}, focusInput = () => {}, createMessage, removeMessage, onState = () => {} } = {}) {
      const elements = { content: surface }
      const messages = new Map()
      const create = createMessage ?? (() => {
        const article = document.createElement('article')
        article.className = 'agent-message agent-message-assistant'
        const bubble = document.createElement('div')
        bubble.className = 'agent-message-bubble'
        const body = document.createElement('div')
        body.className = 'agent-message-body personal-agent-proposals'
        bubble.append(body); article.append(bubble); surface.append(article)
        return { article, body }
      })
      const remove = removeMessage ?? (article => article.remove())
      const rideQuotePrefix = '\u67e5\u770b\u62a5\u4ef7'
      const rideRefreshPrefix = '\u5237\u65b0\u884c\u7a0b'
      let closed = false
      let consumerUnavailable = false
      let consumerId
      let proposalError = ''
      let proposalCommandError = ''
      let errorProposalId = ''
      // Keep dispatched operations reserved until this ID has an authoritative terminal state.
      const actionConfirmations = new Map()
      const intentResponses = new Map()
      const rideStatusNodes = new Map()
      function releaseRideView(id) {
        const { requests, node } = rideStatusNodes.get(id) ?? {}
        if (requests && requests.view === node) delete requests.view
        rideStatusNodes.delete(id)
      }
      function removeEntry(id) {
        const entry = messages.get(id)
        if (!entry) return
        if (entry.advice) { visibility?.unobserve(entry.advice); observedAdvice.delete(entry.advice); visibleAdvice.delete(entry.advice) }
        releaseRideView(id)
        remove(entry.article)
        messages.delete(id)
      }
      const renderedProposalIds = new Set()
      const uncertainActionWarning = 'Response was not delivered. Check the personal agent service; do not repeat an uncertain action.'
      let feedbackFocus
      let proposalEpoch = 0
      let lastStatus = null
      const refreshOpenUI = () => {
        if (closed || !lastStatus) return
        for (const entry of messages.values()) entry.snapshot = ''
        renderProposals(lastStatus)
      }
      requestRenderer(refreshOpenUI)
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
      const dismissMenus = event => {
        for (const entry of messages.values()) if (entry.more?.open && !entry.more.contains(event.target)) entry.more.open = false
      }
      document.addEventListener('pointerdown', dismissMenus)



      async function command(value) {
        const epoch = proposalEpoch
        let refused = false
        const executionAttempt = value.type === 'proposal_respond' && value.decision === 'accept' ? executionAttempts.get(value.id) : undefined
        try {
          const receipt = await api.proposalCommand(value)
          if (!receipt?.accepted) { refused = receipt?.accepted === false; throw Error('Unavailable') }
        } catch {
          if (executionAttempt) {
            if (executionAttempts.get(value.id) !== executionAttempt) return
            executionAttempt.uncertain = true
          }
          if (closed) return
          if (epoch !== proposalEpoch && (!executionAttempt || !renderedProposalIds.has(value.id))) return
          if (value.type === 'proposal_presented') return
          proposalCommandError = uncertainActionWarning
          errorProposalId = value.id ?? ''
          reportState()
          return refused ? 'refused' : undefined
        }
      }
      // State belongs to the identity capsule, never to a message bubble.
      // `detail` carries the full safety assertion for the capsule's accessible name.
      let stateSnapshot = null
      function summarizeState(status, visible) {
        const notes = []
        if (proposalError) notes.push({ rank: 0, caption: status.proposalPartialFailure === true ? 'Some suggestions unavailable' : 'Updates unavailable', detail: String(proposalError) })
        if (proposalCommandError) notes.push({ rank: 1, caption: 'Delivery not confirmed', detail: proposalCommandError })
        // A finished proposal keeps its own outcome on its card. Publishing a
        // terminal word such as Expired here would leave stale text as the
        // Agent's standing state. An unknown outcome is a safety assertion, not
        // a proposal label, so it keeps its priority over a result receipt.
        const activeLabels = { executing: 'In progress', unknown: 'Outcome not confirmed' }
        for (const p of visible) {
          if (!p) continue
          const preview = p.preview || p.ridePreview
          if (executionAttempts.get(p.id)?.uncertain) notes.push({ rank: 2, caption: 'Outcome not confirmed', detail: uncertainActionWarning })
          else if (p.status === 'pending' && executionAttempts.has(p.id)) notes.push({ rank: 3, caption: 'Waiting for result', detail: 'Submitted. Waiting for the result, so do not resend.' })
          if (activeLabels[p.status]) notes.push({ rank: p.status === 'unknown' ? 4 : 5, caption: activeLabels[p.status], detail: activeLabels[p.status] })
          if (p.status === 'pending' && !suggestionCapabilities.respond && typeof p.nextStep === 'string')
            notes.push({ rank: 6, caption: 'Read-only preview', detail: 'Read-only preview; respond from the desk.' })
          if (p.status === 'pending' && !p.action && !p.ridePreview && !proposalSources(p).length && !isReadOnlyIntent(p))
            notes.push({ rank: 7, caption: 'No executable action', detail: 'No executable action is available.' })
          if (preview?.sandbox === true) notes.push({ rank: 8, caption: 'Sandbox preview', detail: 'Sandbox preview, so no real trip.' })
          if (Number.isFinite(preview?.expiresAt) && preview.expiresAt <= Date.now())
            notes.push({ rank: 9, caption: 'Estimate expired', detail: 'Estimate expired.' })
          if (p.result) {
            const raw = String(p.result)
            // Technical receipts stay private; a structured or hashed result becomes
            // a neutral caption. Human-readable results stay readable in the capsule.
            let structured = false
            if (raw.length <= 8192) {
              try { const parsed = JSON.parse(raw); structured = parsed !== null && typeof parsed === 'object' } catch { /* Not JSON. */ }
            }
            const technical = /sha[-_\s]?256|\b[a-f0-9]{32,}\b/i.test(raw) || structured || raw.length > 8192
            notes.push({ rank: 10, caption: 'Result recorded', detail: technical ? 'Result recorded.' : raw })
          }
        }
        notes.sort((a, b) => a.rank - b.rank)
        // The capsule shows one short caption; its accessible name carries every
        // state and safety assertion so none is lost when several apply.
        const ordered = notes.filter((note, index) => notes.findIndex(other => other.detail === note.detail) === index)
        return { caption: ordered[0]?.caption ?? '', detail: ordered.map(note => note.detail).join('. ') }
      }
      function reportState() { if (stateSnapshot) onState(summarizeState(stateSnapshot.status, stateSnapshot.visible)) }
      function button(label, callback) {
        const node = document.createElement('button')
        node.type = 'button'
        node.textContent = label
        node.addEventListener('click', callback)
        return node
      }
      function appendRendered(article, rendered) {
        if (!rendered) return false
        const isCard = typeof rendered.className === 'string' && rendered.className.split(/\s+/).includes('personal-agent-preview-card')
        if (isCard) { article.append(rendered); return true }
        const dom = root.document ?? globalDocument
        const card = dom.createElement('div')
        card.className = 'personal-agent-preview-card'
        card.append(rendered)
        article.append(card)
        return true
      }
      function renderLegacyRidePreview(article, proposal, preview, canRespond) {
        const dom = root.document ?? globalDocument
        let requests = rideRequests.get(proposal.id)
        if (preview.handle && requests?.handle !== preview.handle) {
          requests = { handle: preview.handle, quote: false, refresh: false }
          rideRequests.set(proposal.id, requests)
        }
        const hasExpiry = Number.isFinite(preview.expiresAt)
        const expired = hasExpiry && preview.expiresAt <= Date.now()
        const current = () => proposal.status === 'pending' && (!hasExpiry || !expired)
        const card = dom.createElement('div')
        card.className = 'personal-agent-preview-card personal-agent-ride-card'
        const summaryText = distinctSummary(preview.summary || (preview.from && preview.to ? [preview.from, preview.to].map(places => Array.isArray(places) && places.length === 1 ? String(places[0].name ?? '').slice(0, 256) : 'Choose a place').join(' → ') : ''), proposal.advice)
        if (summaryText) {
          const summary = dom.createElement('p')
          summary.className = 'personal-agent-preview-summary personal-agent-ride-route-display'
          summary.textContent = summaryText
          card.append(summary)
        }
        const items = dom.createElement('div')
        items.className = 'personal-agent-preview-chips personal-agent-ride-items'
        for (const item of Array.isArray(preview.items) ? preview.items.slice(0, 16) : []) {
          const line = dom.createElement('span')
          line.className = 'personal-agent-preview-chip personal-agent-ride-item'
          if (item.tone === 'warn' || item.tone === 'good') line.dataset.tone = item.tone
          const name = dom.createElement('span')
          name.className = 'personal-agent-preview-label personal-agent-ride-product'
          name.textContent = String(item.productName || item.label || '').slice(0, 256)
          const price = dom.createElement('span')
          price.className = 'personal-agent-preview-value personal-agent-ride-price'
          price.textContent = `${String(item.priceText || item.value || '').slice(0, 256)}`
          line.append(name, price)
          items.append(line)
        }
        if (items.children.length) card.append(items)
        const note = dom.createElement('p')
        note.className = 'personal-agent-preview-notice personal-agent-ride-note'
        if (preview.sandbox === true) note.textContent = 'Sandbox preview, so no real trip.'
        else if (hasExpiry && expired) note.textContent = 'Estimate expired.'
        if (card.children.length) article.append(card)

        const hasSelectors = Boolean(preview.from && preview.to)
        let panel, selectors = []
        if (hasSelectors) {
          panel = dom.createElement('section')
          panel.className = 'personal-agent-preview-fields personal-agent-ride-route'
          panel.id = `ride-route-${proposal.id}`
          panel.setAttribute('aria-label', 'Ride route')
          panel.hidden = true
          for (const [key, caption] of [['from', 'Pickup'], ['to', 'Destination']]) {
            const label = dom.createElement('label')
            label.textContent = caption
            const select = dom.createElement('select')
            select.setAttribute('aria-label', caption)
            const choices = Array.isArray(preview[key]) ? preview[key].slice(0, 8) : []
            const blank = dom.createElement('option')
            blank.value = ''; blank.textContent = `Choose ${caption.toLowerCase()}`
            select.append(blank)
            for (const place of choices) {
              const option = dom.createElement('option')
              option.value = typeof place.handle === 'string' ? place.handle : ''
              option.textContent = `${String(place.name ?? '').slice(0, 256)} — ${String(place.city ?? '').slice(0, 80)} ${String(place.address ?? '').slice(0, 256)}`
              select.append(option)
            }
            select.value = choices.length === 1 ? choices[0].handle : ''
            label.append(select); panel.append(label); selectors.push(select)
          }
        }
        const actions = dom.createElement('div')
        actions.className = 'personal-agent-proposal-actions personal-agent-ride-actions'
        const requestStatus = dom.createElement('p')
        requestStatus.className = 'personal-agent-proposal-request-status'
        requestStatus.setAttribute('role', 'status')
        requestStatus.textContent = requests?.message ?? ''
        rideStatusNodes.set(proposal.id, { requests, node: requestStatus })
        if (requests) requests.view = requestStatus
        const showRequestStatus = text => {
          if (requests) requests.message = text
          if (requests?.view) requests.view.textContent = text
        }
        let quoteButton
        const validPreviewHandle = typeof preview.handle === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(preview.handle)
        if (canRespond && validPreviewHandle && current() && !proposal.action) {
          quoteButton = button('Get current quote', async function () {
            if (closed || !surface.contains(quoteButton) || quoteButton.disabled || requests?.quote) return
            const handles = [preview.handle, ...selectors.map(select => select.value)]
            if (!current() || !handles.every(value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)) || (selectors.length && !selectors.every((select, index) => preview[index === 0 ? 'from' : 'to'].some(p => p.handle === select.value)))) {
              note.textContent = 'Choose both places.'
              if (!note.parentElement) card.append(note)
              if (panel) panel.hidden = false
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
              showRequestStatus('Quote requested.')
            } catch {
              showRequestStatus('Delivery is unconfirmed, so check before retrying. No order confirmation was sent.')
            }
          })
          quoteButton.className = 'personal-agent-proposal-primary'
          quoteButton.disabled = requests?.quote === true
          quoteButton.dataset.proposalId = proposal.id
          quoteButton.dataset.proposalAction = 'ride-quote'
          actions.append(quoteButton)
        }
        if (canRespond && validPreviewHandle && ['pending', 'expired'].includes(proposal.status) && !proposal.action) {
          const refresh = button('Refresh preview', async () => {
            if (closed || !surface.contains(refresh) || refresh.disabled || requests?.refresh) return
            requests.refresh = true
            refresh.disabled = true
            showRequestStatus('Sending preview refresh…')
            try {
              const receipt = await api.sendText(`${rideRefreshPrefix} ${preview.handle}`)
              if (!receipt?.accepted) throw Error('Unavailable')
              showRequestStatus('Refresh requested.')
            } catch { showRequestStatus('Delivery is unconfirmed, so check before retrying.') }
          })
          refresh.dataset.proposalId = proposal.id
          refresh.disabled = requests?.refresh === true
          refresh.dataset.proposalAction = 'ride-refresh'
          if (!quoteButton) refresh.className = 'personal-agent-proposal-primary'
          else if (panel) panel.append(refresh)
          if (!quoteButton) actions.append(refresh)
        }
        article.append(actions, requestStatus)
        if (panel) article.append(panel)
        return actions.children.length > 0
      }
      function proposalSources(proposal) {
        if (proposal.action !== null || !Array.isArray(proposal.sources) || proposal.sources.length > 8) return []
        return proposal.sources.every(source =>
          (source?.kind === 'gmail' && source.label === 'Gmail' && typeof source.messageId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(source.messageId)) ||
          (source?.kind === 'calendar' && source.label === 'Calendar' && typeof source.readingId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(source.readingId))) ? proposal.sources : []
      }
      function appendSourceAction(actions, proposal, sources) {
        const source = sources.find(item => item.kind === 'gmail')
        if (!source || typeof api.openProposalGmail !== 'function') return
        const result = document.createElement('p')
        result.className = 'personal-agent-proposal-request-status'
        result.setAttribute('role', 'status')
        const open = button('Open Gmail message', async () => {
          if (closed || open.disabled || !surface.contains(open)) return
          open.disabled = true
          let opened = false
          try { opened = await api.openProposalGmail(proposal.id, source.messageId) === true } catch { /* Report below. */ }
          if (closed || !surface.contains(open)) return
          open.disabled = false
          result.textContent = opened ? '' : 'Gmail could not be opened.'
        })
        open.className = 'personal-agent-proposal-primary'
        open.dataset.proposalId = proposal.id
        open.dataset.proposalAction = 'open-gmail'
        actions.append(open, result)
      }
      function isReadOnlyIntent(proposal) {
        return proposal.action === null && !storedRidePreview(proposal)
          && /^intent-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(proposal.ruleId)
      }
      function renderProposalUI(article, p) {
        const renderer = currentRenderer() ?? requestRenderer(refreshOpenUI)
        if (renderer && typeof renderer.isOpenUINode === 'function' && renderer.isOpenUINode(p.ui)) {
          const rendered = renderer.renderOpenUI(p.ui, { button, document: root.document ?? globalDocument })
          if (appendRendered(article, rendered)) return
        }
        const ride = storedRidePreview(p)
        if (ride) {
          renderLegacyRidePreview(article, p, ride, suggestionCapabilities.respond && typeof api.sendText === 'function')
          return
        }
        if (!renderer) return
        const ui = legacyPreviewUI(p)
        if (!ui || !renderer.isOpenUINode?.(ui)) return
        const rendered = renderer.renderOpenUI(ui, { button, document: root.document ?? globalDocument })
        appendRendered(article, rendered)
      }
      function renderProposals(status) {
        lastStatus = status
        if (status.state === 'unavailable' || status.proposalCapabilities?.read === false) {
          proposalEpoch++
          renderedProposalIds.clear()
          visibility?.disconnect(); observedAdvice.clear(); visibleAdvice.clear(); visibilityAttempts.clear()
          suggestionCapabilities = { read: false, respond: false, acknowledge: false }
          proposalError = ''; proposalCommandError = ''; errorProposalId = ''; visibilityFailure = false; feedbackFocus = undefined
          actionConfirmations.clear()
          for (const id of messages.keys()) removeEntry(id)
          return
        }
        if (!Array.isArray(status.proposals)) return
        renderedProposalIds.clear()
        for (const p of status.proposals) if (p?.id) renderedProposalIds.add(p.id)
        for (const p of status.proposals) if (p && ['completed', 'unknown', 'ignored', 'expired'].includes(p.status)) executionAttempts.delete(p.id)
        const uncertainExecution = status.proposals.some(p => p && executionAttempts.get(p.id)?.uncertain)
        const visibilityBlocked = Boolean(status.proposalError) && status.proposalPartialFailure !== true
        if (visibilityFailure && !visibilityBlocked) visibilityAttempts.clear()
        visibilityFailure = visibilityBlocked
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
        const focused = document.activeElement
        const retainedFocus = focused === document.body ? feedbackFocus : undefined
        const focusId = focused?.dataset?.proposalId || retainedFocus?.id, focusAction = focused?.dataset?.proposalAction || retainedFocus?.action
        feedbackFocus = undefined
        const previousScroll = elements.content.scrollTop
        for (const id of intentResponses.keys()) {
          const proposal = status.proposals.find(p => p?.id === id)
          if (!proposal || proposal.status !== 'pending' || (proposal.feedback === 'snooze' && !proposal.offered
            && Number.isFinite(proposal.snoozedUntil))) intentResponses.delete(id)
        }
        const visible = status.proposals.filter(p => p && typeof p.id === 'string' && typeof p.advice === 'string' &&
          !(isReadOnlyIntent(p) && ['ignored', 'expired'].includes(p.status)) &&
          (p.status !== 'pending' || (p.offered === true && !(p.snoozedUntil > Date.now()))))
        const visibleIds = new Set(visible.map(p => p.id))
        for (const id of messages.keys()) if (!visibleIds.has(id)) removeEntry(id)
        proposalCommandError = uncertainExecution ? uncertainActionWarning : ''
        for (const p of visible) {
            const current = p.status === 'pending'
            const sources = proposalSources(p)
            let entry = messages.get(p.id)
            if (!entry) {
              const created = create(p)
              entry = { ...created, snapshot: '' }
              messages.set(p.id, entry)
            }
            const snapshot = JSON.stringify([p, suggestionCapabilities])
            if (entry.snapshot === snapshot) continue
            entry.snapshot = snapshot
            if (entry.advice) { visibility?.unobserve(entry.advice); observedAdvice.delete(entry.advice); visibleAdvice.delete(entry.advice); entry.advice = undefined }
            releaseRideView(p.id)
            const proposals = entry.body
            const moreWasOpen = entry.more?.open === true
            entry.more = undefined
            proposals.replaceChildren()
            const article = document.createElement('section')
            article.className = 'personal-agent-proposal'
            article.dataset.proposalId = p.id
            const advice = document.createElement('p')
            advice.className = 'personal-agent-proposal-advice'
            const technicalText = /sha[-_\s]?256|\b[a-f0-9]{32,}\b/i
            const technicalAdvice = technicalText.test(p.advice)
            const technicalNext = typeof p.nextStep === 'string' && technicalText.test(p.nextStep)
            const executableAction = Boolean(p.action && typeof p.confirmation === 'string' && p.confirmation.trim())
            const nextStep = typeof p.nextStep === 'string' && p.nextStep.length <= 240 && !/[\x00-\x1f\x7f]/.test(p.nextStep) && !technicalNext ? p.nextStep.trim() : ''
            const readOnlyStep = Boolean(nextStep) && (!suggestionCapabilities.respond || isReadOnlyIntent(p))
            // Advice is model text. Use the shared safe Markdown renderer so
            // strong/code/list emphasis shows, while HTML stays literal and
            // plain text still goes through textContent.
            root.odkPersonalAgentReply.render(advice, technicalAdvice ? 'This message is no longer available. Ask again.' : p.advice)
            if (!technicalAdvice && p.advice.length > 180) {
              advice.dataset.long = 'true'
              advice.setAttribute('tabindex', '0')
              advice.setAttribute('role', 'region')
              advice.setAttribute('aria-label', 'Full message; scroll to read')
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
            article.append(advice)
            if ((readOnlyStep || (executableAction && !current)) && nextStep && !technicalAdvice) {
              const next = document.createElement('div')
              next.className = 'personal-agent-proposal-next'
              const step = document.createElement('p')
              step.className = 'personal-agent-proposal-next-step'
              step.textContent = nextStep
              next.append(step)
              article.append(next)
            }
            if (p.ui || p.preview || p.ridePreview) renderProposalUI(article, p)
            if (current && suggestionCapabilities.respond) {
              const actions = document.createElement('div')
              actions.className = 'personal-agent-proposal-actions'
              const feedbackControls = []
              const more = (...controls) => {
                const menu = document.createElement('details')
                menu.className = 'personal-agent-proposal-more'
                menu.open = moreWasOpen
                const summary = document.createElement('summary')
                summary.textContent = 'More'
                summary.dataset.proposalId = p.id
                summary.dataset.proposalAction = 'more'
                summary.setAttribute('aria-label', 'More reminder controls')
                const group = document.createElement('div')
                group.className = 'personal-agent-proposal-more-controls'
                group.append(...controls)
                menu.append(summary, group)
                menu.addEventListener('keydown', event => {
                  if (event.key !== 'Escape' || !menu.open) return
                  event.preventDefault(); event.stopPropagation()
                  menu.open = false
                  summary.focus({ preventScroll: true })
                })
                entry.more = menu
                return menu
              }
              const response = (label, decision) => {
                const control = button(label, async () => {
                  if (closed || control.disabled || !surface.contains(control) || !suggestionCapabilities.respond
                    || (isReadOnlyIntent(p) && intentResponses.has(p.id))) return
                  const request = {}
                  if (isReadOnlyIntent(p)) {
                    intentResponses.set(p.id, request)
                    for (const sibling of feedbackControls) sibling.disabled = true
                  }
                  if (document.activeElement === control) feedbackFocus = { id: p.id, action: decision }
                  control.disabled = true
                  const result = await command({ type: 'proposal_respond', id: p.id, decision })
                  if (result === 'refused' && intentResponses.get(p.id) === request) {
                    intentResponses.delete(p.id)
                    entry.snapshot = ''
                    if (!closed && lastStatus) renderProposals(lastStatus)
                  }
                })
                control.dataset.proposalId = p.id; control.dataset.proposalAction = decision
                control.disabled = isReadOnlyIntent(p) && intentResponses.has(p.id)
                feedbackControls.push(control)
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
                    entry.snapshot = ''; renderProposals(status)
                    await command({ type: 'proposal_respond', id: p.id, decision: 'accept', confirmation: p.confirmation })
                  })
                  confirm.className = 'personal-agent-proposal-primary'
                  confirm.dataset.proposalId = p.id; confirm.dataset.proposalAction = 'confirm'
                  const cancel = button('Cancel', () => {
                    if (!isCurrent()) return
                    actionConfirmations.delete(p.id)
                    entry.snapshot = ''; renderProposals(status)
                    entry.body.querySelector('[data-proposal-action="execute"]')?.focus({ preventScroll: true })
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
                  actions.append(accept, more(later))
                }
              } else {
                appendSourceAction(actions, p, sources)
                const later = response('Later', 'snooze')
                later.className = 'personal-agent-proposal-secondary'
                later.disabled = executionAttempts.has(p.id) || (isReadOnlyIntent(p) && intentResponses.has(p.id))
                const controls = [later]
                if (sources.length || isReadOnlyIntent(p)) {
                  const ignore = response('Ignore', 'ignore')
                  ignore.className = 'personal-agent-proposal-secondary'
                  controls.push(ignore)
                }
                if (isReadOnlyIntent(p)) {
                  const pause = response('Pause reminder', 'mute')
                  pause.className = 'personal-agent-proposal-secondary'
                  controls.push(pause)
                }
                actions.append(more(...controls))
              }
              article.append(actions)
            }
            proposals.append(article)
            if (current && !technicalAdvice) { entry.advice = advice; observedAdvice.set(advice, p); visibility?.observe(advice) }
        }
        if (focusId && focusAction) {
          let restored = false
          for (const node of messages.get(focusId)?.body.querySelectorAll?.('button, summary') || []) if (node.dataset.proposalId === focusId && node.dataset.proposalAction === focusAction) {
            node.focus({ preventScroll: true }); restored = true; break
          }
          if (!restored) focusInput()
        }
        elements.content.scrollTop = previousScroll
        for (const [node, p] of observedAdvice) acknowledgeVisible(node, p)
        proposalError = status.proposalError || ''
        stateSnapshot = { status, visible }
        reportState()
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
          if (restored) consumerReady()
        },
        async destroy() {
          if (closed) return
          closed = true
          rendererWaiters.delete(refreshOpenUI)
          proposalEpoch++
          actionConfirmations.clear()
          renderedProposalIds.clear()
          visibility?.disconnect()
          for (const id of messages.keys()) removeEntry(id)
          rideStatusNodes.clear()
          observedAdvice.clear(); visibleAdvice.clear(); visibilityAttempts.clear()
          document.removeEventListener('pointerdown', dismissMenus)
          document.removeEventListener('visibilitychange', recheckVisibility)
          document.removeEventListener('visibilitychange', consumerVisibilityChanged)
          await announceConsumer(null)
        },
      }
    },
  }
})(typeof window !== 'undefined' ? window : globalThis)
