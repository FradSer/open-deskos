;(function (root) {
  'use strict'

  const REFRESH_EVERY_TICKS = 5

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

  function escapeHtml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  function envCell(refs, key, value, unit) {
    refs[key].value.textContent = value
    refs[key].unit.textContent = unit
  }

  function renderPlant(refs, index, entry) {
    const plant = refs.plants[index]
    if (!entry) {
      plant.root.className = 'hydra-plant hydra-idle'
      plant.soil.textContent = '--'
      plant.meterFill.style.width = '0%'
      plant.meterFill.classList.remove('hydra-meter-dry')
      return
    }
    const offline = entry.online === false
    const watering = entry.pump === true && !offline
    plant.root.className = `hydra-plant${offline ? ' hydra-offline' : ''}${watering ? ' hydra-watering' : ''}`
    plant.soil.textContent = formatSoil(entry)
    plant.soil.classList.toggle('hydra-soil-watering', watering)
    const percent = offline || entry.soilPercent === undefined || entry.soilPercent === null ? 0 : Math.round(entry.soilPercent)
    plant.meterFill.style.width = `${percent}%`
    plant.meterFill.classList.toggle('hydra-meter-dry', !offline && percent > 0 && percent < 50)
  }

  root.odkPlugins.register({
    id: 'odk.tile.hydra',
    manifest: { schemaVersion: 1 },
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
            <div class="hydra-env-cell" id="hydra-env-temp"><span class="hydra-env-value">--</span><span class="hydra-env-unit">°C</span></div>
            <div class="hydra-env-cell" id="hydra-env-humidity"><span class="hydra-env-value">--</span><span class="hydra-env-unit">%</span></div>
            <div class="hydra-env-cell" id="hydra-env-pressure"><span class="hydra-env-value">--</span><span class="hydra-env-unit">hPa</span></div>
            <div class="hydra-env-cell" id="hydra-env-lux"><span class="hydra-env-value">--</span><span class="hydra-env-unit">lx</span></div>
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
        </div>`

      const body = el.querySelector('.hydra-body')
      const q = (selector) => el.querySelector(selector)
      const badge = q('#hydra-badge')
      const envCells = ['temp', 'humidity', 'pressure', 'lux'].reduce((acc, key) => {
        acc[key] = {
          value: q(`#hydra-env-${key} .hydra-env-value`),
          unit: q(`#hydra-env-${key} .hydra-env-unit`),
        }
        return acc
      }, {})
      const plantRoots = [q('#hydra-plant-1'), q('#hydra-plant-2')]
      const refs = {
        ...envCells,
        plants: plantRoots.map((rootEl) => ({
          root: rootEl,
          soil: rootEl.querySelector('.hydra-plant-soil'),
          meterFill: rootEl.querySelector('.hydra-meter-fill'),
        })),
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
