'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createShellDeskData } = require('../src/desk-data')
const { createDeskDataControl } = require('../src/desk-data-control')

const hydraReading = (overrides = {}) => ({
  configured: true,
  connected: true,
  env: { tempC: 21.4, humidity: 62, stale: false },
  nodes: [{ id: 1, soilPercent: 30, pump: false, stale: false }],
  updatedAt: 1_700_000_000_000,
  ...overrides,
})

function shellDeskData(overrides = {}) {
  return createShellDeskData({
    hydra: { snapshot: () => hydraReading() },
    weather: { refresh: async () => ({ status: 'live', place: 'Shenzhen', unit: 'C', current: { temperature: 21 }, daily: null, updatedAt: 1 }) },
    weread: { refresh: async () => ({ status: 'live', highlight: { title: 'A Book' }, updatedAt: 2 }) },
    futu: { snapshot: (service) => (service === 'futu-poller' ? { state: 'live', service, snapshot: { positions: [{ code: 'US.AAPL', name: 'Apple', qty: 10, currency: 'USD' }] }, updatedAt: 3 } : { state: 'unconfigured', service }) },
    services: () => ({ 'futu-poller': 'Futu holdings' }),
    piSessions: { scan: async () => ({ ok: true, sessions: [{ id: 'a' }, { id: 'b' }], workspaces: ['/root'] }) },
    quota: { read: async () => ({ state: 'available', snapshot: { accounts: [{ id: 'codex' }] } }) },
    store: { list: async () => [{ id: 'pomodoro', name: 'Pomodoro', version: '1', kind: 'widget', revision: 'a'.repeat(32), data: { fields: { remaining_seconds: { type: 'number' } } } }] },
    ...overrides,
  })
}

test('the Shell registers what the desk holds and each reading keeps its own state', async () => {
  const deskData = shellDeskData()
  await deskData.syncPackages()
  const control = createDeskDataControl(deskData.registry)
  const ids = (await control.dispatch({ command: 'list' })).readings.map(reading => reading.id)
  assert.deepEqual(ids.sort(), [
    'futu-poller', 'odk.app.pi-sessions', 'odk.page.quota', 'odk.plugins.installed',
    'odk.tile.hydra', 'odk.tile.weather', 'odk.tile.weread', 'pomodoro',
  ])
  const listed = (await control.dispatch({ command: 'list' })).readings
  assert.deepEqual(listed.find(reading => reading.id === 'futu-poller'), { id: 'futu-poller', label: 'Futu holdings', kind: 'service' })

  const hydra = (await control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' })).reading
  assert.equal(hydra.state, 'live')
  assert.equal(hydra.value.plants[0].soilPercent, 30)
  assert.equal(hydra.value.greenhouse.temperatureC, 21.4)

  const weather = (await control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })).reading
  assert.equal(weather.state, 'live')
  assert.equal(weather.value.place, 'Shenzhen')
})

test('a reading keeps the state its own source reports', async () => {
  const cases = [
    ['odk.tile.hydra', { hydra: { snapshot: () => hydraReading({ configured: false }) } }, 'unconfigured'],
    ['odk.tile.hydra', { hydra: { snapshot: () => hydraReading({ connected: false }) } }, 'unavailable'],
    ['odk.tile.hydra', { hydra: { snapshot: () => hydraReading({ env: { tempC: 21.4, stale: true } }) } }, 'stale'],
    ['odk.tile.weather', { weather: { refresh: async () => ({ status: 'stale', place: 'Shenzhen', current: { temperature: 19 } }) } }, 'stale'],
    ['odk.tile.weather', { weather: { refresh: async () => ({ status: 'unconfigured', current: null }) } }, 'unconfigured'],
    ['odk.tile.weather', { weather: { refresh: async () => ({ status: 'unavailable', current: null, error: 'provider unreachable' }) } }, 'unavailable'],
    ['odk.tile.weread', { weread: { refresh: async () => ({ status: 'loading', highlight: null }) } }, 'unavailable'],
    ['odk.tile.weread', { weread: { refresh: async () => ({ status: 'error', highlight: null, error: 'no key' }) } }, 'unavailable'],
    ['odk.tile.weread', { weread: { refresh: async () => ({ status: 'empty', highlight: null }) } }, 'live'],
    ['odk.page.quota', { quota: { read: async () => ({ state: 'unavailable', reason: 'gateway down' }) } }, 'unavailable'],
    ['odk.page.quota', { quota: { read: async () => ({ state: 'unconfigured' }) } }, 'unconfigured'],
    ['odk.app.pi-sessions', { piSessions: { scan: async () => ({ ok: false, reason: 'SSH scan unavailable' }) } }, 'unavailable'],
  ]
  for (const [readingId, overrides, state] of cases) {
    const control = createDeskDataControl(shellDeskData(overrides).registry)
    const reading = (await control.dispatch({ command: 'read', readingId })).reading
    assert.equal(reading.state, state, readingId)
    if (['unconfigured', 'unavailable'].includes(state)) {
      assert.equal(reading.value, null, `${readingId} as ${state} must present no reading as current`)
    }
  }
})

test('a Service Plugin is answerable under the id its own package declared, and under no other', async () => {
  let declared = { 'futu-poller': 'Futu holdings' }
  const deskData = shellDeskData({ services: () => declared })
  const control = createDeskDataControl(deskData.registry)
  const service = (await control.dispatch({ command: 'read', readingId: 'futu-poller' })).reading
  assert.equal(service.kind, 'service')
  assert.equal(service.value.positions[0].symbol, 'US.AAPL')

  declared = { 'futu-poller': 'Futu holdings', 'broker-quotes': 'Broker quotes' }
  deskData.syncServices()
  const added = (await control.dispatch({ command: 'read', readingId: 'broker-quotes' })).reading
  assert.equal(added.label, 'Broker quotes')
  assert.deepEqual(await control.dispatch({ command: 'read', readingId: 'odk.tile.futu' }), { ok: false, error: 'unknown-reading' })

  declared = {}
  deskData.syncServices()
  assert.deepEqual(await control.dispatch({ command: 'read', readingId: 'futu-poller' }), { ok: false, error: 'unknown-reading' })
})

test('a Service Plugin that is not live presents no holdings', async () => {
  const offline = { state: 'unavailable', service: 'futu-poller', error: 'stale snapshot', updatedAt: 3, snapshot: { positions: [{ symbol: 'AAPL', quantity: 10 }] } }
  for (const state of ['syncing', 'needs-auth', 'unavailable']) {
    const control = createDeskDataControl(shellDeskData({
      futu: { snapshot: () => ({ ...offline, state }) },
      services: () => ({ 'futu-poller': 'Futu holdings' }),
    }).registry)
    const reading = (await control.dispatch({ command: 'read', readingId: 'futu-poller' })).reading
    assert.equal(reading.state, state, 'the plugin own state is reported as itself')
    assert.equal(reading.value, null, `${state} must present no holdings`)
  }
})

test('the installed catalog reading is bounded and says what it left out', async () => {
  const many = Array.from({ length: 40 }, (_, index) => ({ id: `app-${index}`, name: `App ${index}`, version: '1', kind: 'widget', revision: 'a'.repeat(32) }))
  const control = createDeskDataControl(shellDeskData({ store: { list: async () => many } }).registry)
  const reading = (await control.dispatch({ command: 'read', readingId: 'odk.plugins.installed' })).reading
  assert.equal(reading.value.total, 40)
  assert.equal(reading.value.apps.length, 20)
  assert.equal(reading.value.truncated, true)
})

test('a package that declares no data has no reading to answer with', async () => {
  const control = createDeskDataControl(shellDeskData({ store: { list: async () => [{ id: 'notes', name: 'Notes', version: '1', kind: 'widget', revision: 'b'.repeat(32) }] } }).registry)
  const ids = (await control.dispatch({ command: 'list' })).readings.map(reading => reading.id)
  assert.ok(!ids.includes('notes'))
})

test('a removed package stops answering', async () => {
  let installed = [{ id: 'pomodoro', name: 'Pomodoro', version: '1', kind: 'widget', revision: 'a'.repeat(32), data: { fields: { remaining_seconds: { type: 'number' } } } }]
  const deskData = shellDeskData({ store: { list: async () => installed } })
  const control = createDeskDataControl(deskData.registry)
  await deskData.syncPackages()
  assert.equal(deskData.registry.publish('pomodoro', { remaining_seconds: 90 }).ok, true)
  installed = []
  await deskData.syncPackages()
  assert.deepEqual(await control.dispatch({ command: 'read', readingId: 'pomodoro' }), { ok: false, error: 'unknown-reading' })
})

test('an unavailable store is reported as a state rather than as an empty desk', async () => {
  const control = createDeskDataControl(shellDeskData({ store: { list: async () => { throw Error('catalog unreadable') } } }).registry)
  const reading = (await control.dispatch({ command: 'read', readingId: 'odk.plugins.installed' })).reading
  assert.equal(reading.state, 'unavailable')
  assert.equal(reading.value, null)
})

test('reading a source never forces a provider request', async () => {
  const calls = []
  const control = createDeskDataControl(shellDeskData({
    weather: { refresh: async (...args) => { calls.push(args); return { status: 'live', current: { temperature: 21 } } } },
  }).registry)
  await control.dispatch({ command: 'read', readingId: 'odk.tile.weather' })
  assert.deepEqual(calls, [[]], 'a reader has no force affordance; the source keeps its own freshness policy')
})

test('the installed catalog reading names what is installed and where it sits', async () => {
  const installed = [
    { id: 'pomodoro', name: 'Pomodoro', version: '1.2', kind: 'widget', revision: 'a'.repeat(32), placement: { pageId: 'home', col: '1 / 3', row: '1' } },
    { id: 'notes', name: 'Notes', version: '3', kind: 'app', revision: 'b'.repeat(32) },
  ]
  const control = createDeskDataControl(shellDeskData({ store: { list: async () => installed } }).registry)
  const { value } = (await control.dispatch({ command: 'read', readingId: 'odk.plugins.installed' })).reading
  assert.equal(value.total, 2)
  assert.deepEqual(value.apps.map(app => [app.id, app.kind, app.version]), [['pomodoro', 'widget', '1.2'], ['notes', 'app', '3']])
  assert.deepEqual(value.apps[0].placement, { pageId: 'home', col: '1 / 3', row: '1' })
})

test('a catalog that cannot be read is not an empty desk', async () => {
  const installed = [{ id: 'pomodoro', name: 'Pomodoro', version: '1', kind: 'widget', revision: 'a'.repeat(32), data: { fields: { remaining_seconds: { type: 'number' } } } }]
  let catalog = installed
  const deskData = shellDeskData({ store: { list: async () => { if (catalog instanceof Error) throw catalog; return catalog } } })
  const control = createDeskDataControl(deskData.registry)
  await deskData.syncPackages()
  assert.equal(deskData.registry.publish('pomodoro', { remaining_seconds: 90 }).ok, true)

  for (const failure of [Error('catalog unreadable'), null]) {
    catalog = failure
    await deskData.syncPackages()
    const reading = (await control.dispatch({ command: 'read', readingId: 'pomodoro' })).reading
    assert.equal(reading.value.remaining_seconds, 90, 'an unreadable catalog must not retire what the desk holds')
  }
})

test('a reading names only what a spoken answer needs', async () => {
  const control = createDeskDataControl(shellDeskData({
    hydra: { snapshot: () => ({
      configured: true,
      connected: true,
      updatedAt: 1_700_000_000_000,
      mainOnline: false,
      diagnostics: { firmware: '121', build: 'main-node-v121-Sep 22 2026T21:49:05', bootId: '5cf3a0124b00', resetReason: 'software', uptimeSeconds: 630111 },
      env: { tempC: 31.2, humidity: 74.9, pressureHpa: 1008.1, lux: 0.8333, vpdKpa: 1.14, stale: true, updatedAt: 1_700_000_000_000 },
      nodes: [{ id: 1, online: true, pump: false, soilPercent: 55.3, soilUpdatedAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000, status: 'IDLE', stale: true }],
    }) },
    weread: { refresh: async () => ({ status: 'live', updatedAt: 2, highlight: { bookId: '824064', chapterIdx: 22, bookmarkId: '824064_22_2471-2515', range: '2471-2515', markText: 'a quote', colorStyle: 0, type: 1, createTime: 1_756_191_133, title: '人生十讲', author: '季羡林', cover: `data:image/jpeg;base64,${'A'.repeat(20000)}` } }) },
  }).registry)

  const hydra = (await control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' })).reading
  assert.equal(hydra.state, 'stale')
  assert.equal(hydra.value.asOf, '2023-11-14T22:13:20.000Z')
  assert.equal(hydra.value.greenhouse.temperatureC, 31.2)
  assert.equal(hydra.value.greenhouse.humidityPercent, 74.9)
  assert.deepEqual(hydra.value.plants, [{
    id: 1, name: 'Plant 1', soilPercent: 55.3, watering: false, online: true, stale: true, measuredAt: '2023-11-14T22:13:20.000Z',
  }])
  const hydraText = JSON.stringify(hydra.value)
  for (const absent of ['diagnostics', 'firmware', 'bootId', 'uptimeSeconds', 'IDLE', 'vpdKpa']) {
    assert.ok(!hydraText.includes(absent), `a spoken reading must not carry ${absent}`)
  }

  const weread = (await control.dispatch({ command: 'read', readingId: 'odk.tile.weread' })).reading
  assert.deepEqual(weread.value, {
    asOf: new Date(2).toISOString(),
    book: { title: '人生十讲', author: '季羡林' },
    highlight: { text: 'a quote', chapterRange: '2471-2515' },
  })
  assert.ok(JSON.stringify(weread.value).length < 500, 'a cover image is not something a spoken answer needs')
})

test('a reading renames a source field plainly and reports a ratio as the percent the tile shows', async () => {
  const control = createDeskDataControl(shellDeskData({
    futu: { snapshot: () => ({ state: 'live', service: 'futu-poller', updatedAt: 3, snapshot: { positions: [{ code: 'US.TSLA', name: 'Tesla', market: 'US', qty: 19.3171, cost: 53.247, price: 82.53, marketVal: 1594, plVal: 566.4, plRatio: 0.3553, dayPlVal: -234.41, dayRatio: -0.0299, currency: 'USD' }] } }) },
    services: () => ({ 'futu-poller': 'Futu holdings' }),
    quota: { read: async () => ({ state: 'available', snapshot: { accounts: [{ id: 'codex-1', provider: 'codex', fileName: 'codex.json', account: 'me@example.com', plan: null, groups: [{ title: 'Codex limits', description: null, quotas: [{ label: '5 hour limit', remainingPct: 87.5, resetAt: '2026-09-30T09:00:00.000Z', description: null }] }] }], fetchedAt: '2026-09-30T04:00:00.000Z' } }) },
    piSessions: { scan: async () => ({ ok: true, updatedAt: 4, sessions: [{ sessionId: 's-1', uuid: 's-1', pid: 42, isAlive: true, status: 'running', cwd: '/home/desk/open-deskos', workspaceName: 'open-deskos', startedAt: 1, updatedAt: 5, latestGoal: '部署，实际测试', activity: 'bash: pnpm test', modifiedFiles: ['a.js'], source: 'desk-link', reportedBy: 'mac' }], workspaces: ['/home/desk/open-deskos'] }) },
  }).registry)

  const holdings = (await control.dispatch({ command: 'read', readingId: 'futu-poller' })).reading
  assert.equal(holdings.value.asOf, new Date(3).toISOString())
  assert.deepEqual(holdings.value.positions, [{
    symbol: 'US.TSLA', name: 'Tesla', quantity: 19.3171, averageCost: 53.247, price: 82.53,
    marketValue: 1594, profitLoss: 566.4, currency: 'USD',
    dayProfitLoss: -234.41, dayChangePercent: -2.99,
  }])
  assert.equal(holdings.value.totals, null, 'a snapshot with no totals carries none rather than an empty one')

  const quota = (await control.dispatch({ command: 'read', readingId: 'odk.page.quota' })).reading
  assert.deepEqual(quota.value.accounts, [{
    id: 'codex-1', provider: 'codex', account: 'me@example.com', plan: null,
    groups: [{ title: 'Codex limits', windows: [{ label: '5 hour limit', remainingPercent: 87.5, resetsAt: '2026-09-30T09:00:00.000Z' }] }],
  }])

  const sessions = (await control.dispatch({ command: 'read', readingId: 'odk.app.pi-sessions' })).reading
  assert.equal(sessions.value.total, 1)
  assert.deepEqual(sessions.value.sessions, [{
    id: 's-1', project: 'open-deskos', workingDirectory: '/home/desk/open-deskos',
    state: 'running', goal: '部署，实际测试', activity: 'bash: pnpm test', updatedAt: new Date(5).toISOString(),
  }])
})

test('a reading that is not live carries no reading at all', async () => {
  const cases = [
    ['odk.tile.weather', { weather: { refresh: async () => ({ status: 'unavailable', error: 'provider unreachable' }) } }, 'unavailable'],
    ['odk.tile.weather', { weather: { refresh: async () => ({ status: 'unconfigured' }) } }, 'unconfigured'],
    ['odk.tile.weread', { weread: { refresh: async () => ({ status: 'error', highlight: null, error: 'no credential' }) } }, 'unavailable'],
    ['odk.tile.hydra', { hydra: { snapshot: () => hydraReading({ connected: false }) } }, 'unavailable'],
    ['odk.page.quota', { quota: { read: async () => ({ state: 'unavailable', reason: 'gateway down' }) } }, 'unavailable'],
    ['odk.plugins.installed', { store: { list: async () => { throw Error('catalog unreadable') } } }, 'unavailable'],
  ]
  for (const [readingId, overrides, state] of cases) {
    const reading = (await createDeskDataControl(shellDeskData(overrides).registry).dispatch({ command: 'read', readingId })).reading
    assert.equal(reading.state, state, readingId)
    assert.equal(reading.value, null, `${readingId} as ${state} must carry no reading, not an empty one`)
  }

  // A stale reading is the exception that proves the rule: its last measurement
  // is the reading, and it says so rather than presenting it as current.
  const stale = (await createDeskDataControl(shellDeskData({ hydra: { snapshot: () => hydraReading({ env: { tempC: 21.4, stale: true } }) } }).registry)
    .dispatch({ command: 'read', readingId: 'odk.tile.hydra' })).reading
  assert.equal(stale.state, 'stale')
  assert.equal(stale.value.plants[0].soilPercent, 30)
  assert.equal(stale.value.greenhouse.stale, true)
})

test('a reading says when each measurement was taken', async () => {
  const control = createDeskDataControl(shellDeskData({
    hydra: { snapshot: () => ({
      configured: true,
      connected: true,
      updatedAt: 1_700_000_000_000,
      env: { tempC: 31.2, humidity: 74.9, pressureHpa: 1008.1, lux: 0.83, stale: false, updatedAt: 1_699_999_000_000 },
      nodes: [{ id: 1, soilPercent: 55.3, pump: false, soilUpdatedAt: 1_699_998_000_000, updatedAt: 1_699_998_000_000 }],
    }) },
  }).registry)
  const { reading } = await control.dispatch({ command: 'read', readingId: 'odk.tile.hydra' })
  assert.equal(reading.value.asOf, '2023-11-14T22:13:20.000Z', 'the reading states when it was taken')
  assert.equal(reading.value.greenhouse.measuredAt, '2023-11-14T21:56:40.000Z', 'the environment carries its own measurement time')
  assert.equal(reading.value.plants[0].measuredAt, '2023-11-14T21:40:00.000Z', 'so does each plant')
})

test('a Service Plugin reading reports the same percent the tile displays', async () => {
  // The shape and the scale are the poller's, not this test's invention: the
  // position frames carry ratios as fractions and the totals carry the day's
  // change, which is what the tile multiplies by 100 before drawing.
  const snapshot = {
    totals: { marketVal: 313_835.5, plVal: 5_946.95, cash: 4_200.25, dayPlVal: -1_134.41, dayByCcy: { USD: -1_134.41 }, plRatio: -0.0036 },
    positions: [
      { code: 'US.TEM', name: 'Tempus AI', market: '', qty: 91.9268, cost: 53.247, price: 83.69, marketVal: 7_693.35, plVal: 2_798.56, plRatio: 0.5717, dayPlVal: -234.41, dayRatio: -0.0298, currency: 'USD' },
      { code: 'US.TSF', name: 'Direxion Treasury Bull 3X', market: '', qty: 600, cost: 29.894, price: 26.42, marketVal: 15_852, plVal: -2_084.12, plRatio: -0.1162, dayPlVal: -104.41, dayRatio: -0.0065, currency: 'USD' },
    ],
  }
  const control = createDeskDataControl(shellDeskData({
    futu: { snapshot: () => ({ state: 'live', service: 'futu-poller', updatedAt: 3, snapshot }) },
    services: () => ({ 'futu-poller': 'Futu holdings' }),
  }).registry)
  const { value } = (await control.dispatch({ command: 'read', readingId: 'futu-poller' })).reading

  // The tile formats today's ratio and each position's day ratio by multiplying the
  // poller's fraction by 100, so the reading publishes those same percents. It
  // never draws a position's own profit ratio, and nothing in the payload declares
  // that field's scale, so the reading drops it rather than guessing: the loss and
  // the value it is a loss against are both published, which is what a percentage
  // would have been computed from anyway.
  assert.deepEqual(value.positions[0], {
    symbol: 'US.TEM', name: 'Tempus AI', quantity: 91.9268, averageCost: 53.247, price: 83.69,
    marketValue: 7_693.35, profitLoss: 2_798.56, currency: 'USD',
    dayProfitLoss: -234.41, dayChangePercent: -2.98,
  })
  assert.equal('profitPercent' in value.positions[0], false, 'an undeclared scale is not published under a percent name')
  assert.deepEqual(value.totals, {
    marketValue: 313_835.5, profitLoss: 5_946.95, cash: 4_200.25,
    dayProfitLoss: -1_134.41, dayProfitLossByCurrency: { USD: -1_134.41 },
    todayChangePercent: -0.36,
  })
  const dayRatio = snapshot.positions[0].dayRatio
  assert.equal(value.positions[0].dayChangePercent, Number((dayRatio * 100).toFixed(2)))
})

test('a ratio the tile would draw is a ratio the reading publishes, string or number', async () => {
  // The tile formats a ratio with Number(value) * 100, so a numeric string draws a
  // percentage on the desk. A reading that required a number would drop a field
  // the desk is showing, which is the one disagreement this projection forbids.
  const control = createDeskDataControl(shellDeskData({
    futu: { snapshot: () => ({ state: 'live', service: 'futu-poller', updatedAt: 3, snapshot: { positions: [
      { code: 'US.A', qty: 1, marketVal: 100, plVal: 2, dayPlVal: 1, dayRatio: '0.0251', currency: 'USD' },
      { code: 'US.B', qty: 1, marketVal: 100, plVal: -2, dayPlVal: -1, dayRatio: -0.01, currency: 'USD' },
      { code: 'US.C', qty: 1, marketVal: 100, plVal: 0, dayPlVal: 0, dayRatio: 'not-a-number', currency: 'USD' },
      { code: 'US.D', qty: 1, marketVal: 100, plVal: 0, dayPlVal: 0, currency: 'USD' },
    ], totals: { marketVal: 400, plVal: 0, plRatio: '0.0075' } } }) },
    services: () => ({ 'futu-poller': 'Futu holdings' }),
  }).registry)
  const { value } = (await control.dispatch({ command: 'read', readingId: 'futu-poller' })).reading
  assert.equal(value.positions[0].dayChangePercent, 2.51, 'a numeric string is the same ratio the tile draws')
  assert.equal(value.positions[1].dayChangePercent, -1, 'a number is read the same way')
  assert.equal('dayChangePercent' in value.positions[2], false, 'a value no ratio can be read from carries none')
  assert.equal('dayChangePercent' in value.positions[3], false, 'an absent ratio carries none')
  assert.equal(value.totals.todayChangePercent, 0.75)
})
