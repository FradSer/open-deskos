'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const pluginPath = path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'weather.js')
const pluginSource = fs.readFileSync(pluginPath, 'utf8')

function stubNode() {
  return {
    style: {},
    textContent: '',
    className: '',
    innerHTML: '',
    children: [],
    dataset: {},
    attributes: {},
    classList: { toggle() {} },
    setAttribute(name, value) { this.attributes[name] = value },
    replaceChildren(...nodes) { this.children = nodes },
  }
}

function createTile({ snapshot, reject = false, platform = true, delay = 0 } = {}) {
  const nodes = new Map()
  const el = {
    dataset: {},
    attributes: {},
    innerHTML: '',
    setAttribute(name, value) { this.attributes[name] = value },
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, stubNode())
      return nodes.get(selector)
    },
  }
  const ticks = []
  const calls = []
  const root = {
    odkPlugins: { register(definition) { root.registration = definition } },
    odkIcons: { apply() {} },
    document: {
      createElementNS: () => stubNode(),
      getElementById: () => stubNode(),
    },
    odkPlatform: platform ? {
      getWeatherStatus: (request) => {
        calls.push(request)
        if (reject) return Promise.reject(new Error('channel down'))
        return delay ? new Promise((resolve) => setTimeout(() => resolve(snapshot), delay)) : Promise.resolve(snapshot)
      },
    } : undefined,
    setTimeout,
    clearTimeout,
  }
  vm.runInNewContext(pluginSource, { window: root, globalThis: root, document: root.document, setTimeout, clearTimeout, URLSearchParams, Promise, console, Object, Math, String, Number, Array, JSON, Date, Boolean })
  root.registration.mount(el, { onTick: (callback) => { ticks.push(callback); return () => {} } })
  return {
    el,
    nodes,
    calls,
    registration: root.registration,
    update(nextSnapshot) { snapshot = nextSnapshot },
    refs: {
      place: el.querySelector('.w-weather-place'),
      badge: el.querySelector('.w-weather-badge'),
      number: el.querySelector('.w-weather-number'),
      value: el.querySelector('.w-weather-number'),
      unit: el.querySelector('.w-weather-unit'),
      condition: el.querySelector('.w-weather-condition'),
      detail: el.querySelector('.w-weather-detail'),
      high: el.querySelector('#w-weather-high'),
      low: el.querySelector('#w-weather-low'),
    },
    tick(times = 1) {
      for (let index = 0; index < times; index += 1) for (const callback of ticks) callback(Date.now())
    },
    settle: () => new Promise((resolve) => setImmediate(resolve)),
  }
}

const live = {
  status: 'live', place: 'Shenzhen', updatedAt: 1_700_000_000_000, error: null,
  current: { temperature: 25, unit: '°C', condition: 'Clear sky', sky: 'sun', code: 0 },
  daily: { high: 31, low: 24 },
}

test('the header leads with the place, while the reading leads the sky and daily range', async () => {
  const tile = createTile({ snapshot: live })
  await tile.settle()
  assert.equal(tile.refs.place.textContent, 'Shenzhen')
  assert.equal(tile.refs.detail.textContent, '', 'the header already identifies the place')
  const header = pluginSource.slice(pluginSource.indexOf('w-weather-head'), pluginSource.indexOf('w-weather-hero'))
  assert.match(header, /w-weather-place/)
  assert.doesNotMatch(header, /class="w-name"/, 'no redundant Weather heading above a known place')
  const hero = pluginSource.slice(pluginSource.indexOf('w-weather-hero'), pluginSource.indexOf('w-weather-body'))
  assert.ok(hero.indexOf('w-weather-reading') < hero.indexOf('w-weather-glyph'), 'the numeral precedes its supporting icon')
  assert.match(pluginSource, /w-weather-range-label[^>]*>Low</)
  assert.match(pluginSource, /w-weather-range-label[^>]*>High</)
  assert.doesNotMatch(pluginSource, /w-weather-sep/, 'separate range columns need no slash')
})

test('normal weather and stale recovery never show Live or refresh times', async () => {
  const tile = createTile({ snapshot: live })
  await tile.settle()
  assert.equal(tile.refs.badge.textContent, '')
  assert.equal(tile.refs.badge.hidden, true)
  assert.equal(tile.refs.value.textContent, '25')

  tile.update({ ...live, status: 'stale' })
  tile.tick(5)
  await tile.settle()
  assert.equal(tile.refs.badge.textContent, 'Stale')
  assert.equal(tile.refs.badge.hidden, false)
  assert.equal(tile.refs.value.textContent, '25')
  assert.equal(tile.refs.detail.textContent, '')

  tile.update({ ...live, updatedAt: live.updatedAt + 600_000 })
  tile.tick(5)
  await tile.settle()
  assert.equal(tile.refs.badge.textContent, '')
  assert.equal(tile.refs.badge.hidden, true)
  assert.equal(tile.refs.condition.textContent, 'Clear sky')
})

test('the weather condition exposes the shared Widget state role without a success badge', () => {
  assert.match(pluginSource, /class="w-weather-condition w-state"/)
  assert.doesNotMatch(pluginSource, /class="widget-glance-badge w-weather-badge w-state"/)
})

test('the tile waits before the first snapshot instead of claiming a failure', async () => {
  const tile = createTile({ snapshot: live })
  // Mount renders once before any reply has arrived.
  assert.equal(tile.el.dataset.state, 'waiting')
  assert.equal(tile.refs.badge.textContent, 'Waiting')
  assert.equal(tile.refs.value.textContent, '--')
  assert.equal(tile.refs.unit.textContent, '', 'nothing is claimed before the first reply')
  assert.doesNotMatch(tile.refs.condition.textContent, /unavailable|failed|no weather/i)
  assert.doesNotMatch(tile.refs.detail.textContent, /unavailable|failed/i)
  assert.equal(tile.refs.high.textContent, '--')
  assert.equal(tile.refs.low.textContent, '--')
  await tile.settle()
  assert.equal(tile.el.dataset.state, 'live')
})

test('only non-success states render a notice alongside plain copy', async () => {
  const cases = [
    ['live', live, { badge: '', value: '25', condition: 'Clear sky', place: 'Shenzhen', detail: '' }],
    ['stale', { ...live, status: 'stale', error: 'provider timed out after 8000 ms' }, { badge: 'Stale', value: '25', condition: 'Clear sky' }],
    ['unavailable without a place', { status: 'unavailable', place: null, unit: '°C', current: null, daily: null, updatedAt: null, hint: null, error: 'x' },
      { state: 'unavailable', badge: 'Unavailable', value: '--', unit: '°C', condition: 'No weather reading', detail: 'Source unavailable' }],
    ['unavailable', { status: 'unavailable', place: 'Shenzhen', unit: '°C', current: null, daily: null, updatedAt: null, hint: null, error: 'provider responded 503' },
      { badge: 'Unavailable', value: '--', unit: '°C', condition: 'No weather reading', place: 'Shenzhen', detail: 'Source unavailable' }],
    ['unconfigured', { status: 'unconfigured', place: null, unit: '°C', current: null, daily: null, updatedAt: null, hint: 'Set ODK_WEATHER_LAT and ODK_WEATHER_LON', error: null },
      { badge: 'Unconfigured', value: '--', unit: '°C', condition: 'No weather location', detail: 'Location not set' }],
  ]
  for (const [label, snapshot, expected] of cases) {
    const status = expected.state || label
    const tile = createTile({ snapshot })
    await tile.settle()
    assert.equal(tile.el.dataset.state, status, label)
    assert.equal(tile.refs.badge.textContent, expected.badge, status)
    assert.equal(tile.refs.badge.hidden, status === 'live', status)
    assert.equal(tile.refs.value.textContent, expected.value, status)
    assert.equal(tile.refs.condition.textContent, expected.condition, status)
    if (expected.detail !== undefined) assert.equal(tile.refs.detail.textContent, expected.detail, status)
    assert.equal(tile.refs.place.textContent, snapshot.place || 'Weather', status)
    if (expected.unit) assert.equal(tile.refs.unit.textContent, expected.unit, status)
    const tone = { live: 'is-muted', stale: 'is-warn', unavailable: 'is-warn', unconfigured: 'is-muted', waiting: 'is-muted' }[status]
    assert.match(tile.refs.badge.className, new RegExp(`widget-glance-badge w-weather-badge ${tone}`), `${status} badge tone`)
    assert.doesNotMatch(tile.refs.badge.textContent, /ODK_/, status)
  }
})

test('no state puts configuration syntax on the desk', () => {
  assert.doesNotMatch(pluginSource, /Set ODK_|ODK_WEATHER/, 'the tile copy must stay in the product voice')
  assert.doesNotMatch(pluginSource, /setInterval|setTimeout/, 'the tile refreshes through the shared tick')
  // innerHTML is allowed only for the mount template and the local glyph constants.
  assert.doesNotMatch(pluginSource, /innerHTML\s*=\s*(?!\s*(?:`|GLYPHS\[))/, 'only the mount template and glyph constants use innerHTML')
})

test('the longest publishable place keeps every row inside the tile', () => {
  // The source bounds a place to 20 display columns; the tile must render that at the
  // narrowest cell without wrapping the detail row out of its frame.
  const { placeColumns } = require('../src/weather-source')
  assert.ok(placeColumns('深圳市南山区粤海街道') <= 20)
})

test('an unavailable reading still names the place whose reading failed', async () => {
  const tile = createTile({ snapshot: { status: 'unavailable', place: 'Shenzhen', unit: '°C', current: null, daily: null, updatedAt: null, hint: null, error: 'provider responded 503' } })
  await tile.settle()
  assert.equal(tile.refs.place.textContent, 'Shenzhen')
  assert.equal(tile.refs.detail.textContent, 'Source unavailable')
  assert.equal(tile.refs.high.textContent, '--')
  assert.equal(tile.refs.low.textContent, '--')
  assert.match(tile.el.attributes.title, /provider responded 503/)
})

test('a restart shows the last reading before the provider answers', async () => {
  const stale = { ...live, status: 'stale', updatedAt: live.updatedAt - 3600_000, error: null }
  const replies = [stale, live]
  const nodes = new Map()
  const el = {
    dataset: {}, attributes: {}, innerHTML: '',
    setAttribute(name, value) { this.attributes[name] = value },
    querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, stubNode()); return nodes.get(selector) },
  }
  const asked = []
  const root = {
    odkPlugins: { register(definition) { root.registration = definition } },
    odkIcons: { apply() {} },
    document: { createElementNS: () => stubNode(), getElementById: () => stubNode() },
    odkPlatform: { getWeatherStatus: (request) => { asked.push(Boolean(request?.force)); return Promise.resolve(replies[asked.length - 1] || live) } },
    setTimeout, clearTimeout,
  }
  vm.runInNewContext(pluginSource, { window: root, globalThis: root, document: root.document, setTimeout, clearTimeout, URLSearchParams, Promise, console, Object, Math, String, Number, Array, JSON, Date, Boolean })
  root.registration.mount(el, { onTick: () => () => {} })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(asked.slice(0, 2), [false, true], 'the cached reading is asked for first')
  assert.equal(el.dataset.state, 'live', 'the fresh reading is the last word')
  assert.equal(el.querySelector('.w-weather-number').textContent, '25')
})

test('a stale reading keeps its numbers with a time-free notice', async () => {
  const tile = createTile({ snapshot: { ...live, status: 'stale', error: 'provider unavailable' } })
  await tile.settle()
  assert.equal(tile.refs.value.textContent, '25')
  assert.equal(tile.refs.unit.textContent, '°C')
  assert.equal(tile.refs.place.textContent, 'Shenzhen')
  assert.equal(tile.refs.detail.textContent, '')
  assert.equal(tile.refs.badge.textContent, 'Stale')
  assert.match(tile.el.attributes.title, /provider unavailable/, 'the failure stays available without shouting on the tile')
})

test('a snapshot that claims a reading it does not carry is not live', async () => {
  const tile = createTile({ snapshot: { status: 'live', place: 'Shenzhen', current: null, daily: null, updatedAt: null, hint: null, error: null } })
  await tile.settle()
  assert.equal(tile.el.dataset.state, 'unavailable')
  assert.equal(tile.refs.value.textContent, '--')
})

test('a failed IPC channel reads as unavailable, not as weather', async () => {
  const tile = createTile({ reject: true })
  await tile.settle()
  assert.equal(tile.el.dataset.state, 'unavailable')
  assert.equal(tile.refs.value.textContent, '--')
})

test('every weight the stylesheet asks for is one the shipped faces can render', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'weather.css'), 'utf8')
  const rules = css.split('}').map((rule) => rule.trim())
  const montserrat = rules.filter((rule) => /font-family:\s*"Montserrat"/.test(rule))
  assert.ok(montserrat.length > 0, 'the reading still uses the display face')
  for (const rule of montserrat) {
    assert.match(rule, /font-weight:\s*700/, `Montserrat ships Bold only, so 400 here is a faux weight: ${rule.split('\n')[0]}`)
  }
  const regular = rules.filter((rule) => /font-weight:\s*400/.test(rule))
  for (const rule of regular) {
    assert.doesNotMatch(rule, /font-family:\s*"Montserrat"/, `a 400 request must not name a bold-only family: ${rule.split('\n')[0]}`)
  }
})

test('the daily range gives both halves the same treatment', () => {
  assert.match(pluginSource, /w-weather-range-label[^>]*>High</)
  assert.match(pluginSource, /w-weather-range-value[^>]*>--</)
  assert.match(pluginSource, /w-weather-range-label[^>]*>Low</)
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'weather.css'), 'utf8')
  assert.match(css, /\.w-weather-range-label\s*\{[^}]*color:\s*var\(--odk-secondary-strong\)/)
  assert.match(css, /\.w-weather-range-value\s*\{[^}]*color:\s*var\(--odk-primary\)/)
  assert.doesNotMatch(css, /\.w-weather-high\s*\{/, 'the high must not carry a treatment the low lacks')
})

test('the numeral and the unit are separate nodes in one inline flow', () => {
  assert.match(pluginSource, /w-weather-number/, 'the numeral has its own node')
  assert.match(pluginSource, /refs\.number\.textContent = reading/, 'the reading writes only the numeral node, so the unit survives')
  assert.doesNotMatch(pluginSource, /refs\.value\.textContent = reading/, 'the unit’s parent is never written as text')
})

test('the unit shares the reading baseline by construction', () => {
  // Inline inside the numeral: no flex baseline behaviour to get wrong, and the unit
  // cannot drift when the face or the state changes.
  const value = /<span class="w-weather-value">([\s\S]*?)<\/span>\s*<\/div>/.exec(pluginSource)
  assert.ok(value, 'the reading markup is present')
  assert.match(value[1], /w-weather-unit/, 'the unit lives inside the reading')
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'weather.css'), 'utf8')
  const reading = /\.w-weather-reading\s*\{([^}]*)\}/.exec(css)[1]
  assert.match(reading, /display:\s*block/)
  assert.match(reading, /white-space:\s*nowrap/)
  const unit = /\.w-weather-unit\s*\{([^}]*)\}/.exec(css)[1]
  assert.doesNotMatch(unit, /margin-block-start/, 'no top margin can float the unit again')
  assert.match(unit, /letter-spacing:\s*normal/, 'the unit does not inherit the display tracking')
})

test('the sky supports the reading instead of competing with it', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'weather.css'), 'utf8')
  const token = (name) => Number(/([\d.]+)cqi/.exec(new RegExp(`--${name}:\\s*([^;]+);`).exec(css)[1])[1])
  assert.ok(token('w-weather-glyph') <= token('w-weather-reading') * 0.75)
  const head = pluginSource.slice(pluginSource.indexOf('w-weather-head'), pluginSource.indexOf('w-weather-hero'))
  assert.doesNotMatch(head, /w-weather-glyph/)
})

test('the sky artwork is drawn for the size it renders at', () => {
  const icons = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'icons', 'pixelarticons.js'), 'utf8')
  const runs = (mark) => [...mark.matchAll(/[hv](-?\d+)/g)].map((match) => Math.abs(Number(match[1]))).filter((value) => value > 0)
  const weather = [...icons.matchAll(/'weather-([a-z-]+)':\s*'([^']*)'/g)]
  assert.equal(weather.length, 6, 'every sky glyph has a pixel counterpart')
  // Check upstream artwork at the desk's supporting icon size (about 290px content).
  // Live geometry tests also cover the smaller 48px, two-grid-unit variant.
  const glyphCqi = Number(/([\d.]+)cqi/.exec(/--w-weather-glyph:\s*([^;]+);/.exec(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'plugins', 'weather.css'), 'utf8'))[1])[1])
  const renderedPx = (glyphCqi / 100) * 290
  for (const [, name, mark] of weather) {
    const finestPx = (Math.min(...runs(mark)) / 24) * renderedPx
    assert.ok(finestPx >= 2, `weather-${name}'s finest run renders ${finestPx.toFixed(2)}px, under the two-pixel floor`)
  }
  // A full sun circle behind a cloud crosses it and reads as a crossed-out circle, so the
  // stroke art keeps the sun as an arc the cloud closes.
  // Partly cloudy uses the plain cloud: a composed sun-and-cloud reads as a cluster at
  // hero size, so the vocabulary keeps only shapes that stay legible when enlarged.
  assert.doesNotMatch(pluginSource, /weather-sun-cloud/)
  // The rays must reach the row above and below the disc, not float beside it.
  // The pixel set is upstream art now, so the rule is its rhythm plus its provenance.
  for (const [, name, mark] of weather) {
    assert.match(mark, /^<path d="[^"]+"\/>$/, `weather-${name} must be upstream path markup`)
  }
  const notice = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'icons', 'PIXELARTICONS-NOTICE.md'), 'utf8')
  const upstream = { 'weather-sun': 'sun', 'weather-cloud': 'cloud', 'weather-snow': 'snowflake', 'weather-thunder': 'zap', 'weather-unavailable': 'square-alert' }
  for (const [name, icon] of Object.entries(upstream)) {
    assert.ok(notice.includes('| `' + name + '` | ' + icon + ' |'), 'the notice must name ' + icon + ' as the upstream icon for ' + name)
  }
  assert.match(notice, /weather-rain[^\n]*cloud \+ drops/, 'the one composition states its upstream part')
})

test('pixel art snaps through CSS so theme and size changes need no refresh', () => {
  const pixel = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'themes', 'pixel.css'), 'utf8')
  assert.match(pixel, /--w-weather-glyph:\s*round\(nearest,[^;]+24px\)/)
  assert.doesNotMatch(pluginSource, /getBoundingClientRect|slot\.style/, 'no stale inline size can override a resize')
})

test('an unknown sky still draws a neutral glyph instead of an empty box', () => {
  assert.match(pluginSource, /GLYPHS\[name\] \|\| GLYPHS\['weather-cloud'\]/, 'the glyph has a neutral fallback')
})

test('the tile is a display-only registration with its own stylesheet', () => {
  assert.equal(tileRegistration().kind, 'tile')
  assert.equal(tileRegistration().interaction, 'display-only')
  assert.equal(tileRegistration().css, 'plugins/weather.css')
  assert.ok(tileRegistration().state)
  assert.equal(tileRegistration().id, 'odk.tile.weather')
})

test('the reading refreshes on the shared tick, throttled', async () => {
  const tile = createTile({ snapshot: live })
  await tile.settle()
  const afterMount = tile.calls.length
  tile.tick(4)
  await tile.settle()
  assert.equal(tile.calls.length, afterMount, 'four ticks must not re-ask within the interval')
  tile.tick(1)
  await tile.settle()
  assert.equal(tile.calls.length, afterMount + 1, 'the fifth tick asks for a fresh snapshot')
})

function tileRegistration() {
  return createTile({ snapshot: live }).registration
}