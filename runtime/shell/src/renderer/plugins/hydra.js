;(function (root) {
  'use strict'

  const REFRESH_EVERY_TICKS = 5
  const ENV_KEYS = ['temp', 'humidity', 'pressure', 'lux']
  // The plants carry their identity in the label as well as the reading, so a
  // shorter shape states the short form of the same label rather than dropping it.
  const PLANT_LABELS = ['Plant 1', 'Plant 2']
  const PLANT_LABELS_SHORT = ['P1', 'P2']

  // Hydra's full composition is a one-column by two-row slot: four stacked
  // environment rows above two plant rows. Measured in this tile, the slot is
  // whole from a 120px cell, so that is the Minimum Readable Cell it declares.
  // A previous declaration used the layout model's minimum cell, which is a
  // property of one panel rather than of this tile: on a window a few pixels
  // shorter than that panel the grid refused the 1x2 span, the tile fell back to
  // a single square, and the four environment rows were drawn straight through
  // the two plant rows.
  const MIN_CELL = 120
  // Below the tall slot the tile re-composes in the cell it was given rather than
  // letting the cell cut it. Each threshold is the cell this tile was measured
  // drawing that shape in whole, across all three themes; a cell below the last
  // one states that it cannot show the readings rather than showing a broken
  // fragment of them.
  const TALL_MIN_HEIGHT = 240
  const TALL_ASPECT = 1.4
  const COMPACT_MIN_HEIGHT = 180
  const COMPACT_MIN_CELL = 130
  const PLANTS_MIN_CELL = 116
  const PLANTS_MIN_HEIGHT = 120

  function formatNumber(value, digits = 1) {
    return value.toFixed(digits)
  }

  function formatLux(lux) {
    if (lux >= 1000) return `${formatNumber(lux / 1000)}k`
    return formatNumber(lux, lux < 1 ? 2 : 0)
  }

  function formatPressure(pressureHpa) {
    return String(Math.round(pressureHpa))
  }

  function formatSoil(entry) {
    if (entry.online === false) return '--'
    if (entry.soilPercent === undefined || entry.soilPercent === null) return '--'
    return `${Math.round(entry.soilPercent)}%`
  }

  function envCell(refs, key, value, unit) {
    refs[key].value.textContent = value
    refs[key].unit.textContent = unit
  }

  // The shape is decided from the cell the tile was given, never from the window:
  // a 348x724 slot, a 186x400 slot and a 174x348 slot are all the tall shape, and
  // a square cell is not, whatever panel the window was.
  function shapeForCell(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 'tall'
    if (width >= MIN_CELL && height >= TALL_MIN_HEIGHT && height >= width * TALL_ASPECT) return 'tall'
    if (width >= COMPACT_MIN_CELL && height >= COMPACT_MIN_HEIGHT) return 'compact'
    if (width >= PLANTS_MIN_CELL && height >= PLANTS_MIN_HEIGHT) return 'plants'
    return 'small'
  }

  function renderPlant(refs, index, entry) {
    const plant = refs.plants[index]
    if (!entry) {
      plant.root.className = 'hydra-plant hydra-idle'
      plant.soil.textContent = '--'
      plant.soil.classList.remove('hydra-soil-watering')
      plant.meterFill.style.width = '0%'
      plant.meterFill.classList.remove('hydra-meter-dry')
      return
    }
    const offline = entry.online === false
    const stale = entry.stale === true
    const watering = entry.pump === true && !offline && !stale
    plant.root.className = `hydra-plant${offline ? ' hydra-offline' : ''}${stale ? ' hydra-stale' : ''}${watering ? ' hydra-watering' : ''}`
    plant.soil.textContent = formatSoil(entry)
    plant.soil.classList.toggle('hydra-soil-watering', watering)
    const percent = offline || entry.soilPercent === undefined || entry.soilPercent === null ? 0 : Math.round(entry.soilPercent)
    plant.meterFill.style.width = `${percent}%`
    plant.meterFill.classList.toggle('hydra-meter-dry', !offline && percent > 0 && percent < 50)
  }

  root.odkPlugins.register({
    id: 'odk.tile.hydra',
    manifest: { schemaVersion: 1, minCell: MIN_CELL },
    kind: 'tile',
    app: 'Hydra plants',
    state: 'Unconfigured',
    interaction: 'display-only',
    mount(el, ctx) {
      el.innerHTML = `
        <div class="widget-signal hydra-body odk-col">
          <div class="hydra-head">
            <svg data-tabler="leaf" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path stroke="none" d="M0 0h24v24H0z" fill="none" />
              <path d="M5 21c.5 -4.5 2.5 -8 7 -10" />
              <path d="M9 18c6.218 0 10.5 -3.288 11 -12v-2h-4.014c-9 0 -11.986 4 -12 9c0 1 0 3 2 5h3l.014 0" />
            </svg>
            <span class="hydra-title">Hydra</span>
            <span class="hydra-badge" id="hydra-badge">…</span>
          </div>
          <div class="hydra-env">
            <div class="hydra-env-cell" id="hydra-env-temp"><span class="hydra-env-label">Temp</span><span class="hydra-reading"><span class="hydra-env-value">--</span><span class="hydra-env-unit">°C</span></span></div>
            <div class="hydra-env-cell" id="hydra-env-humidity"><span class="hydra-env-label">Humidity</span><span class="hydra-reading"><span class="hydra-env-value">--</span><span class="hydra-env-unit">%</span></span></div>
            <div class="hydra-env-cell" id="hydra-env-pressure"><span class="hydra-env-label">Pressure</span><span class="hydra-reading"><span class="hydra-env-value">--</span><span class="hydra-env-unit">hPa</span></span></div>
            <div class="hydra-env-cell" id="hydra-env-lux"><span class="hydra-env-label">Light</span><span class="hydra-reading"><span class="hydra-env-value">--</span><span class="hydra-env-unit">lx</span></span></div>
          </div>
          <div class="hydra-plants">
            <div class="hydra-plant hydra-idle" id="hydra-plant-1">
              <div class="hydra-plant-row">
                <span class="hydra-plant-name">Plant 1</span>
                <span class="hydra-plant-soil">--</span>
              </div>
              <div class="hydra-meter" aria-hidden="true"><div class="hydra-meter-fill"></div></div>
            </div>
            <div class="hydra-plant hydra-idle" id="hydra-plant-2">
              <div class="hydra-plant-row">
                <span class="hydra-plant-name">Plant 2</span>
                <span class="hydra-plant-soil">--</span>
              </div>
              <div class="hydra-meter" aria-hidden="true"><div class="hydra-meter-fill"></div></div>
            </div>
          </div>
          <p class="hydra-hint" hidden></p>
        </div>`

      const body = el.querySelector('.hydra-body')
      const q = (selector) => el.querySelector(selector)
      const badge = q('#hydra-badge')
      const envCells = ENV_KEYS.reduce((acc, key) => {
        acc[key] = {
          value: q(`#hydra-env-${key} .hydra-env-value`),
          unit: q(`#hydra-env-${key} .hydra-env-unit`),
        }
        return acc
      }, {})
      const plantRoots = [q('#hydra-plant-1'), q('#hydra-plant-2')]
      const hint = q('.hydra-hint')
      const refs = {
        ...envCells,
        plants: plantRoots.map((rootEl) => ({
          root: rootEl,
          name: rootEl.querySelector('.hydra-plant-name'),
          soil: rootEl.querySelector('.hydra-plant-soil'),
          meterFill: rootEl.querySelector('.hydra-meter-fill'),
        })),
      }

      // A glanceable tile re-composes rather than letting the cell cut it. The
      // shape is read from the tile's own box, so the same tile is the tall slot
      // on the reference panel and on a handheld and is something smaller in a
      // square cell, with no host named anywhere in it.
      const fitToCell = () => {
        const box = el.getBoundingClientRect()
        const shape = shapeForCell(box.width, box.height)
        if (body.dataset.shape === shape) return
        body.dataset.shape = shape
        // A cell too small for the tile's own state line says so rather than
        // drawing a fragment of it. A shape that leaves the environment out states
        // the count, because a shortened reading that looks like the whole reading
        // is the one way a glanceable instrument can be quietly wrong. The
        // environment is the reading that goes first: the plants are what the tile
        // is for.
        const note = shape === 'small' ? 'Too small' : shape === 'plants' ? `Not shown · ${ENV_KEYS.length}` : ''
        hint.textContent = note
        hint.hidden = !note
        const labels = shape === 'plants' ? PLANT_LABELS_SHORT : PLANT_LABELS
        refs.plants.forEach((plant, index) => {
          if (plant.name.textContent === labels[index]) return
          plant.name.textContent = labels[index]
          plant.root.title = PLANT_LABELS[index]
        })
      }
      fitToCell()
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(fitToCell)
        observer.observe(el)
        ctx.trackCleanup?.(() => observer.disconnect())
      }

      function render(snapshot) {
        if (!snapshot || snapshot.configured === false) {
          body.classList.add('hydra-unconfigured')
          badge.textContent = 'Unconfigured'
          badge.className = 'hydra-badge hydra-badge-muted'
          envCell(refs, 'temp', '--', '°C')
          envCell(refs, 'humidity', '--', '%')
          envCell(refs, 'pressure', '--', 'hPa')
          envCell(refs, 'lux', '--', 'lx')
          refs.plants.forEach((plant, index) => renderPlant(refs, index, null))
          return
        }
        if (!snapshot.connected) {
          badge.textContent = 'Waiting'
          badge.className = 'hydra-badge hydra-badge-muted'
        } else if (snapshot.mainOnline === false) {
          badge.textContent = 'Offline'
          badge.className = 'hydra-badge hydra-badge-warn'
        } else {
          const envStale = snapshot.env?.stale !== false
          badge.textContent = envStale ? 'Stale env' : 'Live'
          badge.className = `hydra-badge${envStale ? ' hydra-badge-warn' : ' hydra-badge-live'}`
        }
        const env = snapshot.env
        body.classList.remove('hydra-unconfigured')
        body.classList.toggle('hydra-stale', Boolean(env && env.stale))
        envCell(refs, 'temp', env && env.tempC !== undefined ? formatNumber(env.tempC) : '--', '°C')
        envCell(refs, 'humidity', env && env.humidity !== undefined ? formatNumber(env.humidity, 0) : '--', '%')
        envCell(refs, 'pressure', env && env.pressureHpa !== undefined ? formatPressure(env.pressureHpa) : '--', 'hPa')
        envCell(refs, 'lux', env && env.lux !== undefined ? formatLux(env.lux) : '--', 'lx')
        const nodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : []
        refs.plants.forEach((_, index) => renderPlant(refs, index, nodes.find((entry) => entry.id === index + 1)))
      }

      render(null)
      let tickCount = 0
      const refresh = async () => {
        if (typeof root.odkPlatform?.getHydraStatus !== 'function') {
          render(null)
          return
        }
        try {
          render(await root.odkPlatform.getHydraStatus())
        } catch {
          render({ configured: true, connected: false, env: null, nodes: [] })
        }
      }
      ctx.onTick(() => {
        tickCount = (tickCount + 1) % REFRESH_EVERY_TICKS
        if (tickCount === 1) refresh()
      })
      refresh()
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
