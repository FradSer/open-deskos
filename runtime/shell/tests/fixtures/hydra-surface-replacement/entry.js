;(function (root) {
  'use strict'
  // Static HTML and Shell CSS preserve appearance; this entry owns behavior.
  root.odkRendererDevelopment.define({
    id: 'odk.tile.hydra', manifest: { schemaVersion: 1, minCell: 120 },
    kind: 'tile', app: 'Hydra plants', state: 'Unconfigured', interaction: 'display-only', opensApp: 'hydra',
    mount(element, context) {
      element.innerHTML = `
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
      const find = selector => element.querySelector(selector)
      const body = find('.hydra-body'), badge = find('#hydra-badge'), hint = find('.hydra-hint')
      const fields = ['temp', 'humidity', 'pressure', 'lux'].map(key => ({
        value: find(`#hydra-env-${key} .hydra-env-value`), unit: find(`#hydra-env-${key} .hydra-env-unit`) }))
      const plants = [1, 2].map(id => {
        const node = find(`#hydra-plant-${id}`)
        return { id, node, name: node.querySelector('.hydra-plant-name'),
          soil: node.querySelector('.hydra-plant-soil'), meter: node.querySelector('.hydra-meter-fill') }
      })
      let closed = false
      const active = () => !closed && !context.signal?.aborted
      context.trackCleanup(() => { closed = true })
      function fit() {
        if (!active()) return
        const { width, height } = element.getBoundingClientRect()
        let shape = 'tall'
        if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
          shape = width >= 120 && height >= 240 && height >= width * 1.4 ? 'tall'
            : width >= 130 && height >= 180 ? 'compact'
              : width >= 116 && height >= 120 ? 'plants' : 'small'
        }
        if (body.dataset.shape === shape) return
        body.dataset.shape = shape
        hint.textContent = shape === 'small' ? 'Too small' : shape === 'plants' ? 'Not shown · 4' : ''
        hint.hidden = !hint.textContent
        for (const plant of plants) {
          const label = shape === 'plants' ? `P${plant.id}` : `Plant ${plant.id}`
          if (plant.name.textContent === label) continue
          plant.name.textContent = label
          plant.node.title = `Plant ${plant.id}`
        }
      }
      fit()
      if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(fit)
        observer.observe(element)
        context.trackCleanup(() => observer.disconnect())
      }
      function paint(snapshot) {
        if (!active()) return
        const configured = Boolean(snapshot) && snapshot.configured !== false
        if (!configured) {
          body.classList.add('hydra-unconfigured')
          badge.textContent = 'Unconfigured'
          badge.className = 'hydra-badge hydra-badge-muted'
        } else {
          const waiting = !snapshot.connected, offline = snapshot.mainOnline === false, stale = snapshot.env?.stale !== false
          badge.textContent = waiting ? 'Waiting' : offline ? 'Offline' : stale ? 'Stale env' : 'Live'
          badge.className = `hydra-badge ${waiting ? 'hydra-badge-muted' : offline || stale ? 'hydra-badge-warn' : 'hydra-badge-live'}`
          body.classList.remove('hydra-unconfigured')
          body.classList.toggle('hydra-stale', Boolean(snapshot.env && snapshot.env.stale))
        }
        const env = configured ? snapshot.env : null
        const values = [env?.tempC, env?.humidity, env?.pressureHpa, env?.lux]
        const units = ['°C', '%', 'hPa', 'lx']
        fields.forEach((field, index) => {
          const value = values[index]
          field.value.textContent = !env || value === undefined ? '--'
            : index === 0 ? value.toFixed(1) : index === 1 ? value.toFixed(0)
              : index === 2 ? String(Math.round(value)) : value >= 1000 ? `${(value / 1000).toFixed(1)}k`
                : value.toFixed(value < 1 ? 2 : 0)
          field.unit.textContent = units[index]
        })
        const entries = configured && Array.isArray(snapshot.nodes) ? snapshot.nodes : []
        for (const plant of plants) {
          const entry = entries.find(value => value.id === plant.id)
          if (!entry) {
            plant.node.className = 'hydra-plant hydra-idle'
            plant.soil.textContent = '--'
            plant.soil.classList.remove('hydra-soil-watering')
            plant.meter.style.transform = 'scaleX(0)'
            plant.meter.classList.remove('hydra-meter-dry')
            continue
          }
          const offline = entry.online === false, stale = entry.stale === true
          const watering = entry.pump === true && !offline && !stale
          const missing = entry.soilPercent === undefined || entry.soilPercent === null
          const percent = offline || missing ? 0 : Math.round(entry.soilPercent)
          plant.node.className = `hydra-plant${offline ? ' hydra-offline' : ''}${stale ? ' hydra-stale' : ''}${watering ? ' hydra-watering' : ''}`
          plant.soil.textContent = offline || missing ? '--' : `${Math.round(entry.soilPercent)}%`
          plant.soil.classList.toggle('hydra-soil-watering', watering)
          plant.meter.style.transform = `scaleX(${percent / 100})`
          plant.meter.classList.toggle('hydra-meter-dry', !offline && percent > 0 && percent < 50)
        }
      }
      paint(null)
      async function read() {
        if (!active()) return
        if (typeof root.odkPlatform?.getHydraStatus !== 'function') { paint(null); return }
        try { paint(await root.odkPlatform.getHydraStatus()) }
        catch { paint({ configured: true, connected: false, env: null, nodes: [] }) }
      }
      let count = 0
      context.onTick(() => {
        if (!active()) return
        count = (count + 1) % 5
        if (count === 1) void read()
      })
      void read()
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
