;(function (root) {
  'use strict'

  // Continuations read the same bounded IPC snapshots as their source Widgets.
  function register(id, name, load, render) {
    root.odkPlugins.register({
      id: `odk.app.${id}`, manifest: { schemaVersion: 1 }, kind: 'app', appId: id,
      app: name, name, appKind: 'ui', source: 'builtin', capabilities: [],
      css: 'plugins/reading-apps.css',
      mount(el, ctx) {
        el.innerHTML = `<section class="runtime-app reading-app ${id}-app"><header class="reading-head"><h2 class="sr-only">${name}</h2><button class="button-pill button-secondary reading-refresh" type="button">Refresh</button></header><p class="reading-status app-detail" role="status"></p><div class="reading-content"></div></section>`
        const status = el.querySelector('.reading-status')
        const content = el.querySelector('.reading-content')
        const refreshButton = el.querySelector('.reading-refresh')
        let released = false
        let pending = false
        ctx.trackCleanup(() => { released = true })
        const refresh = async () => {
          if (released || pending) return
          pending = true
          refreshButton.disabled = true
          status.textContent = 'Refreshing'
          try {
            const snapshot = await load()
            if (released) return
            render(content, status, snapshot)
          } catch {
            if (!released) status.textContent = 'Source unavailable. Select Refresh to try again.'
          } finally {
            pending = false
            if (!released) refreshButton.disabled = false
          }
        }
        refreshButton.addEventListener('click', refresh)
        refresh()
        let ticks = 0
        ctx.onTick(() => { if (++ticks % 30 === 0) refresh() })
      },
    })
  }

  function node(tag, text, className = '') {
    const el = document.createElement(tag)
    el.className = className
    el.textContent = text
    return el
  }
  const value = (reading, unit = '') => Number.isFinite(reading) ? `${reading}${unit}` : '--'
  function readingStatus(snapshot, available, source) {
    if (snapshot?.status === 'unconfigured') return `Connect ${source}, then select Refresh.`
    if (snapshot?.status === 'needs-auth') return `Renew ${source} authorization, then select Refresh.`
    if (snapshot?.status === 'live' && available) return ''
    if (available) return 'Showing the previous reading. Select Refresh to try again.'
    return 'Reading unavailable or incomplete. Select Refresh to try again.'
  }
  function values(entries, className = 'reading-values') {
    const list = document.createElement('dl')
    list.className = className
    for (const [label, reading] of entries) {
      const row = document.createElement('div')
      row.append(node('dt', label), node('dd', reading))
      list.append(row)
    }
    return list
  }

  register('weather', 'Weather', () => root.odkPlatform.getWeatherStatus({ force: true }), (content, status, snapshot) => {
    const current = snapshot?.current
    status.textContent = readingStatus(snapshot, Number.isFinite(current?.temperature), 'the weather source')
    const hero = node('section', '', 'weather-hero')
    hero.append(node('h3', snapshot?.place || 'Location not configured', 'weather-place'),
      node('p', value(current?.temperature, current?.unit || ''), 'weather-reading'),
      node('p', current?.condition || 'No weather reading', 'weather-condition'))
    content.replaceChildren(hero, values([['Low', value(snapshot?.daily?.low, '°')], ['High', value(snapshot?.daily?.high, '°')]], 'reading-values weather-range'))
  })

  register('hydra', 'Hydra plants', () => root.odkPlatform.getHydraStatus(), (content, status, snapshot) => {
    status.textContent = !snapshot?.configured ? 'Not configured' : !snapshot.connected ? 'Waiting for sensors' : snapshot.mainOnline === false ? 'Offline. Waiting for the controller.' : snapshot.env?.stale ? 'Stale environment readings' : ''
    const env = snapshot?.env
    const plants = (Array.isArray(snapshot?.nodes) ? snapshot.nodes : []).map(plant => [`Plant ${plant.id}`, plant.online === false ? 'Offline' : `${plant.stale ? 'Stale: ' : ''}${value(plant.soilPercent, '%')}${plant.pump && !plant.stale && plant.online !== false ? ' · Watering' : ''}`])
    const environment = values([['Temperature', value(env?.tempC, '°C')], ['Humidity', value(env?.humidity, '%')],
      ['Pressure', value(env?.pressureHpa, ' hPa')], ['Light', value(env?.lux, ' lx')]], 'reading-values environment-readings')
    content.replaceChildren(values(plants, 'reading-values plant-readings'), environment)
  })

  register('weread', 'WeRead', () => root.odkPlatform.getWeReadHighlight(), (content, status, snapshot) => {
    const highlight = snapshot?.highlight
    const available = typeof highlight?.markText === 'string' && highlight.markText.trim().length > 0
    status.textContent = readingStatus(snapshot, available, 'WeRead')
    if (!available) { content.replaceChildren(node('p', 'No highlights available', 'app-detail')); return }
    const quote = node('blockquote', highlight.markText || '', 'reading-excerpt')
    const title = node('h3', highlight.title || 'WeRead', 'reading-book-title')
    const author = node('p', highlight.author || '', 'app-detail')
    const metadata = document.createElement('div')
    metadata.className = 'reading-book-meta'
    metadata.append(title, author)
    if (highlight.createTime) {
      const date = new Date(highlight.createTime < 1e12 ? highlight.createTime * 1000 : highlight.createTime)
      if (Number.isFinite(date.getTime())) {
        const time = node('time', new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date), 'app-detail')
        time.dateTime = date.toISOString()
        metadata.append(time)
      }
    }
    const book = document.createElement('footer')
    book.className = 'reading-book'
    book.append(metadata)
    if (highlight.cover?.startsWith('data:image/')) {
      const cover = document.createElement('img')
      cover.className = 'reading-book-cover'
      cover.alt = ''
      cover.src = highlight.cover
      book.append(cover)
    }
    content.replaceChildren(quote, book)
  })

})(typeof window !== 'undefined' ? window : globalThis)
