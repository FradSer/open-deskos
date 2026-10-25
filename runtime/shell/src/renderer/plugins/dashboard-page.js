;
(function (root) {
  'use strict'

  const ICONS = {
  "sessions": {
    "name": "terminal-2",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M8 9l3 3l-3 3\" /><path d=\"M13 15l3 0\" /><path d=\"M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12\" />"
  },
  "plants": {
    "name": "leaf",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M5 21c.5 -4.5 2.5 -8 7 -10\" /><path d=\"M9 18c6.218 0 10.5 -3.288 11 -12v-2h-4.014c-9 0 -11.986 4 -12 9c0 1 0 3 2 5h3l.014 0\" />"
  },
  "weather": {
    "name": "weather-cloud",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M6.657 18c-2.572 0 -4.657 -2.007 -4.657 -4.483c0 -2.475 2.085 -4.482 4.657 -4.482c.393 -1.762 1.794 -3.2 3.675 -3.773c1.88 -.572 3.956 -.193 5.444 1c1.488 1.19 2.162 3.007 1.77 4.769h.99c1.913 0 3.464 1.56 3.464 3.486c0 1.927 -1.551 3.487 -3.465 3.487h-11.878\" />"
  },
  "mail": {
    "name": "mail",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10\" /><path d=\"M3 7l9 6l9 -6\" />"
  },
  "calendar": {
    "name": "calendar",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12\" /><path d=\"M16 3v4\" /><path d=\"M8 3v4\" /><path d=\"M4 11h16\" /><path d=\"M11 15h1\" /><path d=\"M12 15v3\" />"
  },
  "tasks": {
    "name": "checkbox",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M9 11l3 3l8 -8\" /><path d=\"M20 12v6a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h9\" />"
  },
  "reading": {
    "name": "book-open",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0\" /><path d=\"M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0\" /><path d=\"M3 6l0 13\" /><path d=\"M12 6l0 13\" /><path d=\"M21 6l0 13\" />"
  },
  "portfolio": {
    "name": "chart-line",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M4 19l16 0\" /><path d=\"M4 15l4 -6l4 2l4 -5l4 4\" />"
  },
  "quota": {
    "name": "gauge",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\" /><path d=\"M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" /><path d=\"M13.41 10.59l2.59 -2.59\" /><path d=\"M7 12a5 5 0 0 1 5 -5\" />"
  },
  "apps": {
    "name": "apps",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M4 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4\" /><path d=\"M4 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4\" /><path d=\"M14 15a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -4\" /><path d=\"M14 7l6 0\" /><path d=\"M17 4l0 6\" />"
  },
  "status": {
    "name": "info-circle",
    "paths": "<path stroke=\"none\" d=\"M0 0h24v24H0z\" fill=\"none\" /><path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" /><path d=\"M12 9h.01\" /><path d=\"M11 12h1v4h1\" />"
  }
}

  const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December']
  const LABELS = {
    loading: 'Personal Agent has no new desk briefing.',
    live: 'Personal Agent',
    empty: 'Personal Agent has no new desk briefing.',
    unavailable: 'Personal Agent is unavailable.',
    error: 'Personal Agent could not update your briefing. It will retry.',
    stale: 'Previous briefing. Personal Agent could not confirm current desk state.',
  }

  function appendText(el, text, portfolioLive = false, portfolio = false) {
    for (const part of text.split(portfolio ? /([+-]?\d+(?:\.\d+)?[°º]C|[°º]C|[+-]?\d+(?:\.\d+)?%)/ : /([+-]?\d+(?:\.\d+)?[°º]C|[°º]C)/)) {
      if (/[°º]C$/.test(part)) {
        const measurement = el.ownerDocument.createElement('span')
        measurement.className = 'dash-temperature'
        measurement.append(el.ownerDocument.createTextNode(part.slice(0, -2)))
        const unit = el.ownerDocument.createElement('span')
        unit.className = 'dash-unit'
        const degree = el.ownerDocument.createElement('span')
        degree.className = 'dash-unit-degree'
        degree.textContent = part.slice(-2, -1)
        unit.append(degree, el.ownerDocument.createTextNode('C'))
        measurement.append(unit)
        el.append(measurement)
      } else if (portfolio && /^[+-]?\d+(?:\.\d+)?%$/.test(part)) {
        const change = el.ownerDocument.createElement('span')
        change.className = 'dash-change'
        change.textContent = part
        const value = Number(part.slice(0, -1))
        if (portfolioLive && value !== 0 && /^[+-]/.test(part)) change.dataset.direction = value > 0 ? 'up' : 'down'
        el.append(change)
      } else el.append(el.ownerDocument.createTextNode(part))
    }
  }

  function appendMarkdown(el, text, portfolioLive, portfolio) {
    const body = el.ownerDocument.createElement('div')
    root.odkPersonalAgentReply.render(body, text)
    if (!body.classList.contains('personal-agent-status-markdown')) return false
    body.className = 'dash-markdown'
    const walker = el.ownerDocument.createTreeWalker(body, 4)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    for (const node of nodes) {
      // Keep code literal; apply measurement styling to Markdown prose only.
      if (node.parentElement.closest('code, pre')) continue
      const fragment = el.ownerDocument.createDocumentFragment()
      appendText(fragment, node.textContent, portfolioLive, portfolio)
      node.replaceWith(fragment)
    }
    el.append(body)
    return true
  }

  function renderBriefing(el, frame) {
    const doc = el.ownerDocument
    const narrative = el.querySelector('#dash-narrative')
    const label = LABELS[frame.state] || LABELS.unavailable
    const presence = el.querySelector('.dash-presence')
    presence.dataset.state = frame.state
    const statusLabel = frame.state === 'loading' ? 'Updating Overview.'
      : frame.state === 'unavailable' ? 'Overview unavailable. Waiting to reconnect.'
        : frame.state === 'error' ? 'Overview update failed. It will retry automatically.'
          : frame.state === 'stale' ? 'Overview could not confirm current readings. It will retry automatically.' : label
    presence.setAttribute('aria-label', statusLabel)
    presence.title = statusLabel
    narrative.dataset.state = frame.state
    narrative.setAttribute('aria-busy', String(frame.state === 'loading'))
    const coverage = frame.coverage
    const coverageText = coverage ? `Read ${coverage.readSources} of ${coverage.totalSources} connected sources; ${coverage.failedSources} unavailable or stale; ${coverage.incompleteSources} partial; ${coverage.selectedSources} selected.` : ''
    narrative.setAttribute('aria-description', coverageText)
    narrative.title = coverageText
    narrative.replaceChildren()
    for (const [index, item] of frame.items.entries()) {
      if (index) narrative.append(doc.createTextNode(' '))
      const clause = doc.createElement('div')
      clause.className = 'dash-clause'
      clause.dataset.briefing = `agent-${index}`
      const fallbackIcon = item.sources.some(source => /mail/i.test(source.id)) ? 'mail' : 'status'
      for (const segment of item.segments || [{ text: item.text, icon: fallbackIcon }]) {
        const span = doc.createElement('div')
        const icon = ICONS[segment.icon]
        const portfolio = segment.icon === 'portfolio'
        const portfolioLive = frame.state === 'live' && item.sources.length > 0 && item.sources.every(source => source.state === 'live')
        span.className = icon ? 'dash-fact' : 'dash-context'
        if (icon) {
          // SVG paths are repository-owned; source Markdown uses the safe local parser.
          const glyph = doc.createElement('span')
          glyph.className = 'dash-icon'
          glyph.dataset.kind = segment.icon
          if (frame.state === 'live' && item.sources.length && item.sources.every(source => source.state === 'live')) glyph.dataset.state = 'live'
          glyph.innerHTML = `<svg data-tabler="${icon.name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icon.paths}</svg>`
          if (appendMarkdown(span, segment.text, portfolioLive, portfolio)) span.prepend(glyph)
          else {
            const token = doc.createElement('span')
            token.className = 'dash-token'
            const leading = segment.text.match(/^\s*/)[0]
            const word = segment.text.slice(leading.length).match(/^\S+/)[0]
            const prefix = leading + (word.length <= 8 || /^[+-]?\d+(?:\.\d+)?%$/.test(word) ? word : Array.from(word)[0])
            token.append(glyph)
            appendText(token, prefix, portfolioLive, portfolio)
            span.append(token)
            appendText(span, segment.text.slice(prefix.length), portfolioLive, portfolio)
          }
        } else if (!appendMarkdown(span, segment.text)) appendText(span, segment.text)
        clause.append(span)
      }
      narrative.append(clause)
    }
    root.odkIcons?.apply?.(narrative)
    if (!frame.items.length && !['error', 'stale', 'unavailable'].includes(frame.state)) {
      const clause = doc.createElement('div')
      clause.className = 'dash-clause'
      clause.textContent = label
      narrative.append(clause)
    }
  }

  root.odkPlugins.register({
    id: 'odk.page.dashboard',
    manifest: { schemaVersion: 1 },
    kind: 'page',
    surface: 'display',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="dash">
          <header class="dash-head">
            <div class="dash-wd" id="dash-wd"></div>
            <span class="dash-presence" role="status" aria-live="polite" aria-atomic="true"></span>
            <div class="dash-date text-right">
              <span id="dash-md"></span><span id="dash-y"></span>
            </div>
          </header>
          <div class="dash-narrative" id="dash-narrative" role="status" aria-live="polite" aria-atomic="true"></div>
        </div>`

      const wd = el.querySelector('#dash-wd')
      const md = el.querySelector('#dash-md')
      const year = el.querySelector('#dash-y')

      let released = false
      const active = () => !released && !ctx.signal?.aborted
      const host = el.closest?.('#home-summary')
      const narrative = el.querySelector('#dash-narrative')
      const fonts = el.ownerDocument.fonts
      let fitFrame = null
      const fitCopy = () => {
        if (!active() || !host?.clientHeight || !narrative.clientWidth) return
        const bottom = parseFloat(root.getComputedStyle(el.querySelector('.dash')).paddingBottom) || 0
        const available = host.clientHeight - (narrative.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop) - bottom
        if (available <= 0) return
        // Fit only the copy. The date row and the 3x1 card keep their geometry.
        const minimum = root.getComputedStyle(host).overflowY === 'clip' ? 14 : 16
        for (let size = 48; size >= minimum; size--) {
          narrative.style.setProperty('--overview-copy-size', `${size}px`)
          if (narrative.scrollHeight <= available && narrative.scrollWidth <= narrative.clientWidth) break
        }
      }
      const queueFit = () => {
        if (!active() || fitFrame !== null || !host) return
        if (typeof root.requestAnimationFrame !== 'function') { fitCopy(); return }
        fitFrame = root.requestAnimationFrame(() => { fitFrame = null; fitCopy() })
      }
      const observer = host && typeof root.ResizeObserver === 'function' ? new root.ResizeObserver(queueFit) : null
      observer?.observe(host)
      observer?.observe(el.querySelector('.dash-head'))
      const themeObserver = host && typeof root.MutationObserver === 'function' ? new root.MutationObserver(queueFit) : null
      if (themeObserver) themeObserver.observe(el.ownerDocument.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
      fonts?.ready?.then(queueFit, () => {})
      fonts?.addEventListener?.('loadingdone', queueFit)
      ctx.trackCleanup?.(() => {
        released = true
        if (fitFrame !== null) root.cancelAnimationFrame?.(fitFrame)
        observer?.disconnect()
        themeObserver?.disconnect()
        fonts?.removeEventListener?.('loadingdone', queueFit)
      })
      const updateBriefing = (frame) => {
        if (active()) { renderBriefing(el, frame); fitCopy() }
      }
      updateBriefing(ctx.homeBriefing.snapshot())
      ctx.trackCleanup?.(ctx.homeBriefing.subscribe(updateBriefing))
      ctx.onTick((now) => {
        if (!active()) return
        const nextDay = WEEKDAYS_EN[now.getDay()]
        const nextDate = `${MONTHS_EN[now.getMonth()]} ${now.getDate()}`
        const nextYear = String(now.getFullYear())
        const changed = wd.textContent !== nextDay || md.textContent !== nextDate || year.textContent !== nextYear
        wd.textContent = nextDay
        md.textContent = nextDate
        year.textContent = nextYear
        if (changed) queueFit()
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
