;
(function (root) {
  'use strict'

  const REFRESH_EVERY_TICKS = 5

  // Outline skies use the shared icon seam; Pixel swaps in upstream Pixelarticons.
  const GLYPHS = {
    'weather-sun': '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41m11.32-11.32 1.41-1.41"/>',
    'weather-cloud': '<path d="M16.5 19a3.6 3.6 0 0 0-.4-7.2 4.8 4.8 0 0 0-9 1.6A3.6 3.6 0 0 0 7.6 19Z"/>',
    'weather-rain': '<path d="M16.5 15a3.6 3.6 0 0 0-.4-7.2 4.8 4.8 0 0 0-9 1.6A3.6 3.6 0 0 0 7.6 15Z"/><path d="M8 18v3m4-3v3m4-2v2"/>',
    'weather-snow': '<path d="M16.5 15a3.6 3.6 0 0 0-.4-7.2 4.8 4.8 0 0 0-9 1.6A3.6 3.6 0 0 0 7.6 15Z"/><path d="M8 19h.01M12 20h.01M16 19h.01"/>',
    'weather-thunder': '<path d="M16.5 15a3.6 3.6 0 0 0-.4-7.2 4.8 4.8 0 0 0-9 1.6A3.6 3.6 0 0 0 7.6 15Z"/><path d="M13 17l-3 4h3l-1 3 4-4.5h-3L15 17Z"/>',
    'weather-unavailable': '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5m0 3.5h.01"/>',
  }

  // Successful weather needs no status label. Waiting and degraded readings keep
  // short notices so a cached reading or missing source cannot look current.
  const STATES = {
    waiting: { badge: 'Waiting', tone: 'is-muted', condition: 'No reading yet', detail: '' },
    live: { badge: '', tone: 'is-muted', condition: null, detail: null },
    stale: { badge: 'Stale', tone: 'is-warn', condition: null, detail: null },
    unavailable: { badge: 'Unavailable', tone: 'is-warn', condition: 'No weather reading', detail: 'Source unavailable' },
    unconfigured: { badge: 'Unconfigured', tone: 'is-muted', condition: 'No weather location', detail: 'Location not set' },
  }

  root.odkPlugins.register({
    id: 'odk.tile.weather',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'Weather',
    state: 'Unavailable',
    interaction: 'display-only',
    css: 'plugins/weather.css',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-signal w-weather-content">
          <div class="w-weather-head">
            <span class="w-weather-place">Weather</span>
            <span class="widget-glance-badge w-weather-badge">Waiting</span>
          </div>
          <div class="w-weather-main">
            <div class="w-weather-hero">
              <div class="w-weather-reading">
                <span class="w-weather-value"><span class="w-weather-number">--</span><span class="w-weather-unit"></span></span>
              </div>
              <span class="w-weather-glyph" id="w-weather-glyph-slot"></span>
            </div>
            <div class="w-weather-body">
              <span class="w-weather-condition w-state">No reading yet</span>
              <span class="w-weather-detail"></span>
            </div>
          </div>
          <div class="w-weather-range">
            <span class="w-weather-range-pair">
              <span class="w-weather-range-label">Low</span>
              <span class="w-weather-range-value" id="w-weather-low">--</span>
            </span>
            <span class="w-weather-range-pair">
              <span class="w-weather-range-label">High</span>
              <span class="w-weather-range-value" id="w-weather-high">--</span>
            </span>
          </div>
        </div>`

      const refs = {
        slot: el.querySelector('#w-weather-glyph-slot'),
        place: el.querySelector('.w-weather-place'),
        badge: el.querySelector('.w-weather-badge'),
        // The numeral has its own node: writing the unit's parent would wipe the unit.
        number: el.querySelector('.w-weather-number'),
        unit: el.querySelector('.w-weather-unit'),
        condition: el.querySelector('.w-weather-condition'),
        detail: el.querySelector('.w-weather-detail'),
        high: el.querySelector('#w-weather-high'),
        low: el.querySelector('#w-weather-low'),
      }
      let glyphName = ''
      let lastRead = ''

      // A fresh <svg> per glyph keeps core/icons.js's per-element original in sync
      // with the condition that is actually showing.
      function setGlyph(name) {
        if (glyphName === name) return
        glyphName = name
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('data-tabler', name)
        svg.setAttribute('aria-hidden', 'true')
        svg.setAttribute('viewBox', '0 0 24 24')
        svg.setAttribute('fill', 'none')
        svg.setAttribute('stroke', 'currentColor')
        svg.setAttribute('stroke-width', '2')
        svg.setAttribute('stroke-linecap', 'round')
        svg.setAttribute('stroke-linejoin', 'round')
        // A sky this tile does not draw falls back to the neutral cloud rather than an
        // empty box, so a stale feed can never leave the hero row blank.
        svg.innerHTML = GLYPHS[name] || GLYPHS['weather-cloud']
        refs.slot.replaceChildren(svg)
        root.odkIcons?.apply?.(el)
      }

      function render(snapshot) {
        const reported = Object.prototype.hasOwnProperty.call(STATES, snapshot?.status) ? snapshot.status : 'unavailable'
        const reading = snapshot?.current || null
        // A snapshot that claims a reading it does not carry is not live, and no reply yet
        // is not a failure: the tile never shows a state word the payload cannot back.
        const status = !snapshot ? 'waiting' : (reported === 'live' && !reading ? 'unavailable' : reported)
        const state = STATES[status]
        const daily = snapshot?.daily || null
        el.dataset.state = status
        el.dataset.readingLength = String(reading ? String(reading.temperature).length : 2)
        refs.place.textContent = snapshot?.place || 'Weather'
        setGlyph(reading ? `weather-${reading.sky}` : (status === 'waiting' ? 'weather-cloud' : 'weather-unavailable'))
        refs.badge.textContent = state.badge
        refs.badge.hidden = !state.badge
        refs.badge.className = `widget-glance-badge w-weather-badge ${state.tone}`
        refs.number.textContent = reading ? String(reading.temperature) : '--'
        // The unit belongs to the instrument, not to the reading: `-- °C` still reads as a
        // temperature surface, the way the Hydra cells show `-- °C` for a missing value.
        refs.unit.textContent = reading ? reading.unit : (snapshot?.unit || '')
        refs.condition.textContent = reading ? reading.condition : state.condition
        refs.detail.textContent = state.detail || ''
        // Both halves of the range are one kind of datum, so only the labels recede.
        refs.high.textContent = daily ? `${daily.high}°` : '--'
        refs.low.textContent = daily ? `${daily.low}°` : '--'
        const signalled = `${status}|${snapshot?.place || ''}|${snapshot?.updatedAt || ''}`
        if (signalled !== lastRead) {
          lastRead = signalled
          el.setAttribute('title', snapshot?.error ? `Weather source: ${snapshot.error}` : '')
        }
      }

      async function refresh(force) {
        try {
          const snapshot = await root.odkPlatform?.getWeatherStatus?.({ force: Boolean(force) })
          render(snapshot)
        } catch {
          render({ status: 'unavailable', error: 'status channel unavailable' })
        }
      }

      render(null)
      // Whatever the desk already knows first, then the provider: chained so a slower
      // reply can never overwrite a newer reading with an older one.
      void refresh(false).then(() => refresh(true))
      let ticks = 0
      ctx.onTick(() => {
        ticks += 1
        if (ticks % REFRESH_EVERY_TICKS === 0) void refresh(false)
      })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)