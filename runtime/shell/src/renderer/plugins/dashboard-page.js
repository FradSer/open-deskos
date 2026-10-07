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
    loading: 'Personal Agent is updating your briefing.',
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

  function renderBriefing(el, frame) {
    const doc = el.ownerDocument
    const narrative = el.querySelector('#dash-narrative')
    const status = el.querySelector('#dash-agent-status')
    const label = LABELS[frame.state] || LABELS.unavailable
    el.querySelector('.dash-presence').dataset.state = frame.state
    const updated = frame.generatedAt ? new Date(frame.generatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''
    status.textContent = label + (frame.state === 'loading' && frame.items.length ? ' Previous briefing shown.' : '') + (updated ? ` · Updated ${updated}` : '')
    narrative.dataset.state = frame.state
    narrative.replaceChildren()
    const provenance = el.querySelector('#dash-source-list')
    provenance.replaceChildren()
    for (const [index, item] of frame.items.entries()) {
      if (index) narrative.append(doc.createTextNode(' '))
      const clause = doc.createElement('span')
      clause.className = 'dash-clause'
      clause.dataset.briefing = `agent-${index}`
      const fallbackIcon = item.sources.some(source => /mail/i.test(source.id)) ? 'mail' : 'status'
      for (const segment of item.segments || [{ text: item.text, icon: fallbackIcon }]) {
        const span = doc.createElement('span')
        const icon = ICONS[segment.icon]
        const portfolio = segment.icon === 'portfolio'
        const portfolioLive = frame.state === 'live' && item.sources.length > 0 && item.sources.every(source => source.state === 'live')
        span.className = icon ? 'dash-fact' : 'dash-context'
        if (icon) {
          // Only repository-owned SVG paths enter HTML; agent text stays literal.
          const glyph = doc.createElement('span')
          glyph.className = 'dash-icon'
          glyph.dataset.kind = segment.icon
          if (frame.state === 'live' && item.sources.length && item.sources.every(source => source.state === 'live')) glyph.dataset.state = 'live'
          glyph.innerHTML = `<svg data-tabler="${icon.name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${icon.paths}</svg>`
          const token = doc.createElement('span')
          token.className = 'dash-token'
          const leading = segment.text.match(/^\s*/)[0]
          const word = segment.text.slice(leading.length).match(/^\S+/)[0]
          const prefix = leading + (word.length <= 8 || /^[+-]?\d+(?:\.\d+)?%$/.test(word) ? word : Array.from(word)[0])
          token.append(glyph)
          appendText(token, prefix, portfolioLive, portfolio)
          span.append(token)
          appendText(span, segment.text.slice(prefix.length), portfolioLive, portfolio)
        } else appendText(span, segment.text)
        clause.append(span)
      }
      narrative.append(clause)
      const sources = doc.createElement('p')
      sources.className = 'dash-sources'
      sources.textContent = item.sources.map(source => {
        const time = source.updatedAt ? new Date(source.updatedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'Measurement time unavailable'
        return `${source.label} · ${source.state} · ${time}`
      }).join(' / ')
      provenance.append(sources)
    }
    el.querySelector('.dash-provenance').hidden = !frame.items.length && !frame.omittedSources
    root.odkIcons?.apply?.(narrative)
    if (!frame.items.length) {
      const clause = doc.createElement('span')
      clause.className = 'dash-clause'
      clause.textContent = label
      narrative.append(clause)
    }
    if (frame.omittedSources) {
      const omitted = doc.createElement('p')
      omitted.className = 'dash-sources'
      omitted.textContent = `${frame.omittedSources} ${frame.omittedSources === 1 ? 'source was' : 'sources were'} outside the briefing limit.`
      provenance.append(omitted)
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
            <span class="dash-presence" aria-hidden="true"></span>
            <div class="dash-date text-right">
              <span id="dash-md"></span>
              <span id="dash-y"></span>
            </div>
          </header>
          <p class="dash-narrative" id="dash-narrative"></p>
          <footer class="dash-foot">
            <p class="dash-agent-status" id="dash-agent-status" role="status" aria-live="polite"></p>
            <details class="dash-provenance">
              <summary>Sources</summary>
              <div id="dash-source-list"></div>
            </details>
          </footer>
        </div>`

      const wd = el.querySelector('#dash-wd')
      const md = el.querySelector('#dash-md')
      const year = el.querySelector('#dash-y')

      renderBriefing(el, ctx.homeBriefing.snapshot())
      ctx.trackCleanup?.(ctx.homeBriefing.subscribe((frame) => renderBriefing(el, frame)))
      ctx.onTick((now) => {
        wd.textContent = WEEKDAYS_EN[now.getDay()]
        md.textContent = `${MONTHS_EN[now.getMonth()]} ${now.getDate()}`
        year.textContent = String(now.getFullYear())
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
