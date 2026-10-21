;(function (root) {
  'use strict'

  // Shared visual assets preserve the existing Weather layout and sky artwork.
  const GLYPHS = {
    'weather-sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"/>',
    'weather-cloud': '<path d="M16.5 19a3.6 3.6 0 0 0-.4-7.2 4.8 4.8 0 0 0-9 1.6A3.6 3.6 0 0 0 7.6 19Z"/>',
    'weather-rain': '<path d="M16.5 15a3.6 3.6 0 0 0-.4-7.2 4.8 4.8 0 0 0-9 1.6A3.6 3.6 0 0 0 7.6 15Z"/><path d="M8 18v3m4-3v3m4-2v2"/>',
    'weather-snow': '<path d="M16.5 15a3.6 3.6 0 0 0-.4-7.2 4.8 4.8 0 0 0-9 1.6A3.6 3.6 0 0 0 7.6 15Z"/><path d="M8 19h.01M12 20h.01M16 19h.01"/>',
    'weather-thunder': '<path d="M16.5 15a3.6 3.6 0 0 0-.4-7.2 4.8 4.8 0 0 0-9 1.6A3.6 3.6 0 0 0 7.6 15Z"/><path d="M13 17l-3 4h3l-1 3 4-4.5h-3L15 17Z"/>',
    'weather-unavailable': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5m0 3.5h.01"/>',
  }

  const notices = {
    waiting: ['Waiting', 'is-muted', 'No reading yet', ''],
    live: ['', 'is-muted', null, null],
    stale: ['Stale', 'is-warn', null, null],
    unavailable: ['Unavailable', 'is-warn', 'No weather reading', 'Open Weather to retry'],
    unconfigured: ['Unconfigured', 'is-muted', 'No weather location', 'Open Weather for details'],
  }
  root.odkRendererDevelopment.define({
    id: 'odk.tile.weather', manifest: { schemaVersion: 1 }, kind: 'tile', app: 'Weather',
    state: 'Unavailable', interaction: 'display-only', opensApp: 'weather', css: 'plugins/weather.css',
    mount(element, context) {
      let open = true
      context.trackCleanup(() => { open = false })
      const usable = () => open && !context.signal?.aborted
      element.innerHTML = `
        <div class="widget-signal w-weather-content">
          <div class="w-weather-head">
            <span class="w-weather-place widget-heading">Weather</span>
            <span class="widget-glance-badge w-weather-badge">Waiting</span>
          </div>
          <div class="w-weather-main">
            <div class="w-weather-hero">
              <div class="w-weather-reading">
                <span class="w-weather-value"><span class="w-weather-number">--</span><span class="w-weather-unit"></span></span>
              </div>
            </div>
          </div>
          <div class="w-weather-support">
            <span class="w-weather-glyph" id="w-weather-glyph-slot"></span>
            <div class="w-weather-body">
              <span class="w-weather-condition w-state">No reading yet</span>
              <span class="w-weather-detail"></span>
            </div>
            <span class="w-weather-range">
              <span class="w-weather-range-label">H:</span>
              <span class="w-weather-range-value" id="w-weather-high">--</span>
              <span class="w-weather-range-label">L:</span>
              <span class="w-weather-range-value" id="w-weather-low">--</span>
            </span>
          </div>
        </div>`
      const selectors = {
        place: '.w-weather-place', badge: '.w-weather-badge', number: '.w-weather-number',
        unit: '.w-weather-unit', condition: '.w-weather-condition', detail: '.w-weather-detail',
        low: '#w-weather-low', high: '#w-weather-high', icon: '#w-weather-glyph-slot',
      }
      const nodes = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, element.querySelector(selector)]))
      let icon = null
      let observation = null
      function display(value) {
        if (!usable()) return
        const current = value?.current || null
        const reported = Object.hasOwn(notices, value?.status) ? value.status : 'unavailable'
        const state = !value ? 'waiting' : reported === 'live' && !current ? 'unavailable' : reported
        const [badge, tone, condition, detail] = notices[state]
        const temperature = current ? String(current.temperature) : '--'
        element.dataset.state = state
        element.dataset.readingLength = String(temperature.length)
        const fields = {
          place: value?.place || 'Weather', badge, number: temperature,
          unit: current ? current.unit : value?.unit || '',
          condition: current ? current.condition : condition, detail: detail || '',
          low: value?.daily ? `${value.daily.low}°` : '--', high: value?.daily ? `${value.daily.high}°` : '--',
        }
        for (const [key, text] of Object.entries(fields)) nodes[key].textContent = text
        nodes.badge.hidden = badge.length === 0
        nodes.badge.className = `widget-glance-badge w-weather-badge ${tone}`
        const nextIcon = current ? `weather-${current.sky}` : state === 'waiting' ? 'weather-cloud' : 'weather-unavailable'
        if (nextIcon !== icon) {
          icon = nextIcon
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
          const attributes = { 'data-tabler': icon, 'aria-hidden': 'true', viewBox: '0 0 24 24', fill: 'none',
            stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }
          for (const [key, value] of Object.entries(attributes)) svg.setAttribute(key, value)
          svg.innerHTML = GLYPHS[icon] || GLYPHS['weather-cloud']
          nodes.icon.replaceChildren(svg)
          root.odkIcons?.apply?.(element)
        }
        const nextObservation = `${state}|${value?.place || ''}|${value?.updatedAt || ''}`
        if (nextObservation !== observation) {
          observation = nextObservation
          element.setAttribute('title', value?.error ? `Weather source: ${value.error}` : '')
        }
      }
      async function update(forced) {
        if (!usable()) return
        try {
          const value = await root.odkPlatform?.getWeatherStatus?.({ force: Boolean(forced) })
          display(value)
        } catch { display({ status: 'unavailable', error: 'status channel unavailable' }) }
      }
      display(null)
      void (async () => { await update(false); await update(true) })()
      let count = 0
      context.onTick(() => {
        if (!usable()) return
        count++
        if (count % 5 === 0) void update(false)
      })
      element.dataset.fixtureSurface = 'independent-weather'
    },
  })
})(window)
