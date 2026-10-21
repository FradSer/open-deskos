;(function (root) {
  'use strict'

  // Continuations read the same bounded IPC snapshots as their source Widgets.
  function register(id, name, load, render) {
    root.odkPlugins.register({
      id: `odk.app.${id}`, manifest: { schemaVersion: 1 }, kind: 'app', appId: id,
      app: name, name, appKind: 'ui', source: 'builtin', capabilities: [],
      css: 'plugins/reading-apps.css',
      mount(el, ctx) {
        const tapToRefresh = id === 'weread'
        const header = tapToRefresh ? `<h2 class="sr-only">${name}</h2>` : `<header class="reading-head"><h2 class="sr-only">${name}</h2><button class="button-pill button-secondary reading-refresh" type="button">Refresh</button></header>`
        el.innerHTML = `<section class="runtime-app reading-app ${id}-app${tapToRefresh ? ' w-weread' : ''}">${header}<p class="reading-status app-detail" role="status"></p><div class="reading-content"></div></section>`
        const surface = el.querySelector('.reading-app')
        const status = el.querySelector('.reading-status')
        const content = el.querySelector('.reading-content')
        if (id === 'weread') content.classList.add('weread-copy')
        const refreshButton = el.querySelector('.reading-refresh')
        let released = false
        let pending = false
        let observer
        ctx.trackCleanup(() => { released = true })
        const fit = () => {
          if (!released && tapToRefresh) root.odkWeReadTypography.fit(surface, content, content.querySelector('.weread-text'), content.querySelector('.weread-foot'), document.querySelector?.('.widget.w-weread'))
        }
        if (tapToRefresh && typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(fit)
          observer.observe(surface)
          ctx.trackCleanup(() => observer.disconnect())
        }
        const fitAfterFonts = () => { fit() }
        if (tapToRefresh && document.fonts) document.fonts.ready.then(fitAfterFonts).catch(() => {})
        const refresh = async () => {
          if (released || pending) return
          pending = true
          if (refreshButton) refreshButton.disabled = true
          surface.setAttribute('aria-busy', 'true')
          status.textContent = 'Refreshing'
          try {
            const snapshot = await load()
            if (released) return
            render(content, status, snapshot)
            if (observer) {
              observer.disconnect()
              observer.observe(surface)
              const foot = content.querySelector('.weread-foot')
              if (foot) observer.observe(foot)
            }
            if (tapToRefresh) status.textContent = status.textContent.replaceAll('select Refresh', 'click the reading').replaceAll('Select Refresh', 'Click the reading')
            fit()
          } catch {
            if (!released) status.textContent = tapToRefresh ? 'Source unavailable. Click the reading to try again.' : 'Source unavailable. Select Refresh to try again.'
          } finally {
            pending = false
            if (!released) {
              if (refreshButton) refreshButton.disabled = false
              surface.setAttribute('aria-busy', 'false')
            }
          }
        }
        if (tapToRefresh) {
          surface.tabIndex = 0
          surface.setAttribute('role', 'region')
          surface.setAttribute('aria-label', 'WeRead. Click or press Enter to refresh.')
          surface.setAttribute('aria-keyshortcuts', 'Enter Space')
          surface.addEventListener('click', () => {
            if (root.getSelection?.()?.isCollapsed === false) return
            refresh()
          })
          surface.addEventListener('keydown', event => {
            if (event.target !== surface || event.repeat || !['Enter', ' '].includes(event.key)) return
            event.preventDefault()
            event.stopPropagation()
            refresh()
          })
        } else refreshButton.addEventListener('click', refresh)
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
    const quote = node('blockquote', highlight.markText || '', 'reading-excerpt weread-text')
    quote.tabIndex = 0
    quote.setAttribute('role', 'region')
    quote.setAttribute('aria-label', 'Highlight excerpt')
    const title = node('h3', String(highlight.title || 'WeRead').replace(/^[\s《〈【『]+|[\s》〉】』]+$/g, '').trim() || 'WeRead', 'reading-book-title weread-title')
    const author = node('p', highlight.author || '', 'weread-author')
    const metadata = document.createElement('div')
    metadata.className = 'reading-book-meta weread-meta'
    metadata.append(title, author)
    if (highlight.createTime) {
      const date = new Date(highlight.createTime < 1e12 ? highlight.createTime * 1000 : highlight.createTime)
      if (Number.isFinite(date.getTime())) {
        const time = node('time', new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date), 'weread-date')
        time.dateTime = date.toISOString()
        metadata.append(time)
      }
    }
    const book = document.createElement('footer')
    book.className = 'reading-book weread-foot'
    book.tabIndex = 0
    book.setAttribute('aria-label', 'Book details')
    book.append(metadata)
    const wrap = node('div', '', 'weread-cover-wrap')
    wrap.hidden = !highlight.cover?.startsWith('data:image/')
    book.append(wrap)
    if (!wrap.hidden) {
      const cover = document.createElement('img')
      cover.className = 'reading-book-cover weread-cover'
      cover.alt = ''
      cover.src = highlight.cover
      wrap.append(cover)
    }
    content.replaceChildren(quote, book)
  })

})(typeof window !== 'undefined' ? window : globalThis)
