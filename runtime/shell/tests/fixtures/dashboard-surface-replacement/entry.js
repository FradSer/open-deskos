;(function (root) {
  'use strict'
  // Approved static artwork is shared; rendering and subscription ownership are independent.
  const artwork = {
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
  const messages = new Map([
    ['loading', 'Personal Agent is updating your briefing.'], ['live', 'Personal Agent'],
    ['empty', 'Personal Agent has no new desk briefing.'], ['unavailable', 'Personal Agent is unavailable.'],
    ['error', 'Personal Agent could not update your briefing. It will retry.'],
    ['stale', 'Previous briefing. Personal Agent could not confirm current desk state.'],
  ])
  const clock = value => new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  root.odkRendererDevelopment.define({
    id: 'odk.page.dashboard', manifest: { schemaVersion: 1, version: '2.0.0' },
    kind: 'page', surface: 'display',
    mount(container, context) {
      const doc = container.ownerDocument
      const make = (tag, className, text = '') => {
        const element = doc.createElement(tag)
        element.className = className
        element.textContent = text
        return element
      }
      const identified = (tag, className, id) => {
        const element = make(tag, className); element.id = id; return element
      }
      const shell = make('div', 'dash'), header = make('header', 'dash-head')
      const weekday = identified('div', 'dash-wd', 'dash-wd'), presence = make('span', 'dash-presence')
      presence.setAttribute('aria-hidden', 'true')
      const date = make('div', 'dash-date text-right')
      const monthDay = identified('span', '', 'dash-md'), year = identified('span', '', 'dash-y')
      date.append(monthDay, year); header.append(weekday, presence, date)
      const paragraph = identified('p', 'dash-narrative', 'dash-narrative')
      const footer = make('footer', 'dash-foot'), status = identified('p', 'dash-agent-status', 'dash-agent-status')
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite')
      const disclosure = make('details', 'dash-provenance'), sourceList = identified('div', '', 'dash-source-list')
      disclosure.append(make('summary', '', 'Sources'), sourceList)
      footer.append(status, disclosure); shell.append(header, paragraph, footer); container.replaceChildren(shell)
      let released = false
      context.trackCleanup(() => { released = true })
      const current = () => !released && !context.signal?.aborted
      function literal(parent, text, portfolio, live) {
        const expression = portfolio ? /[+-]?\d+(?:\.\d+)?[°º]C|[°º]C|[+-]?\d+(?:\.\d+)?%/g
          : /[+-]?\d+(?:\.\d+)?[°º]C|[°º]C/g
        let position = 0
        for (const match of text.matchAll(expression)) {
          parent.append(doc.createTextNode(text.slice(position, match.index)))
          const token = match[0]
          if (token.endsWith('%')) {
            const change = make('span', 'dash-change', token), value = parseFloat(token)
            if (live && value && (token[0] === '+' || token[0] === '-')) change.dataset.direction = value > 0 ? 'up' : 'down'
            parent.append(change)
          } else {
            const temperature = make('span', 'dash-temperature', token.slice(0, -2))
            const unit = make('span', 'dash-unit')
            unit.append(make('span', 'dash-unit-degree', token.at(-2)), doc.createTextNode('C'))
            temperature.append(unit); parent.append(temperature)
          }
          position = match.index + token.length
        }
        parent.append(doc.createTextNode(text.slice(position)))
      }
      function update(frame) {
        if (!current()) return
        const label = messages.get(frame.state) || messages.get('unavailable')
        presence.dataset.state = frame.state; paragraph.dataset.state = frame.state
        status.textContent = [label, frame.state === 'loading' && frame.items.length ? ' Previous briefing shown.' : '',
          frame.generatedAt ? ' · Updated ' + clock(frame.generatedAt) : ''].join('')
        paragraph.replaceChildren(); sourceList.replaceChildren()
        frame.items.forEach((item, index) => {
          if (index) paragraph.append(doc.createTextNode(' '))
          const clause = make('span', 'dash-clause'); clause.dataset.briefing = 'agent-' + index
          const fallback = item.sources.some(source => source.id.toLowerCase().includes('mail')) ? 'mail' : 'status'
          const live = frame.state === 'live' && item.sources.length > 0 && item.sources.every(source => source.state === 'live')
          for (const segment of item.segments || [{ text: item.text, icon: fallback }]) {
            const art = artwork[segment.icon], fact = make('span', art ? 'dash-fact' : 'dash-context')
            if (art) {
              const icon = make('span', 'dash-icon'); icon.dataset.kind = segment.icon
              if (live) icon.dataset.state = 'live'
              icon.innerHTML = '<svg data-tabler="' + art.name + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + art.paths + '</svg>'
              const joined = make('span', 'dash-token'); joined.append(icon)
              const whitespace = segment.text.search(/\S/)
              const word = segment.text.slice(whitespace).split(/\s/)[0]
              const length = word.length <= 8 || /^[+-]?\d+(?:\.\d+)?%$/.test(word) ? word.length : [...word][0].length
              const boundary = whitespace + length
              literal(joined, segment.text.slice(0, boundary), segment.icon === 'portfolio', live)
              fact.append(joined)
              literal(fact, segment.text.slice(boundary), segment.icon === 'portfolio', live)
            } else literal(fact, segment.text, false, false)
            clause.append(fact)
          }
          paragraph.append(clause)
          sourceList.append(make('p', 'dash-sources', item.sources.map(source => [source.label, source.state,
            source.updatedAt ? clock(source.updatedAt) : 'Measurement time unavailable'].join(' · ')).join(' / ')))
        })
        disclosure.hidden = frame.items.length === 0 && !frame.omittedSources
        if (frame.items.length === 0) paragraph.append(make('span', 'dash-clause', label))
        if (frame.omittedSources) sourceList.append(make('p', 'dash-sources', frame.omittedSources +
          (frame.omittedSources === 1 ? ' source was' : ' sources were') + ' outside the briefing limit.'))
        root.odkIcons.apply(paragraph)
      }
      update(context.homeBriefing.snapshot())
      context.trackCleanup(context.homeBriefing.subscribe(update))
      context.onTick(now => {
        if (!current()) return
        weekday.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(now)
        monthDay.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(now)
        year.textContent = String(now.getFullYear())
      })
    },
  })
})(window)
