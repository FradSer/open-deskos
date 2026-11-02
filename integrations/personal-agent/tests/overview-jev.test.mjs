import test from 'node:test'
import assert from 'node:assert/strict'
import { buildOverviewFactQuestions, createOverviewJevJudge } from '../src/overview-jev.mjs'
import { createJevClient } from '../src/jev-client.mjs'
import { homeFactVariables, generateHomeSelection, compileHomeSelection } from '../src/home-template.mjs'

const source = (id, icon, value, fields = Object.keys(value)) => ({
  id, label: id, kind: 'service', state: 'live',
  home: { mode: 'optional', priority: 50, icon, fields },
  value,
})

test('buildOverviewFactQuestions builds questions for displayable facts only', () => {
  const readings = [
    source('futu', 'portfolio', { todayChangePercent: 2.5 }),
    source('weather', 'weather', { temperatureC: 24, condition: 'Sunny' }),
  ]
  const facts = homeFactVariables(readings)
  const questions = buildOverviewFactQuestions(facts)
  assert.ok(Object.keys(questions).length > 0)
  for (const [id, q] of Object.entries(questions)) {
    assert.equal(q.type, 'noul')
    assert.match(q.instructions, /Judge candidates\.q\d+/)
    assert.ok(q.criteria.true && q.criteria.false)
  }
})

test('verification context reaches judgment without becoming a display fact', async () => {
  let captured
  const readings = [source('audit', 'sessions', { report: 'Check complete', verification: 'failed' })]
  const judge = createOverviewJevJudge({ client: async ({ state, questions }) => {
    captured = state
    return { model: 'jev-latest', answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'noul', noul: 0.8 }])) }
  } })
  const raw = await generateHomeSelection(readings, { judge, choose: async () => { throw Error('not needed') } })
  const { resolveHomeTemplate } = await import('../src/home-template.mjs')
  assert.match(JSON.stringify(captured), /verification.*failed/)
  assert.doesNotMatch(JSON.stringify(captured), /Check complete/)
  assert.match(resolveHomeTemplate(raw, readings).items[0].text, /reported: Check complete/)
  assert.doesNotMatch(resolveHomeTemplate(raw, readings).items[0].text, /verification:/)
})

test('judged selection keeps the glance to the strongest facts', async () => {
  const readings = [
    source('quota', 'quota', { accounts: [{ name: 'Main', remainingPercent: 6 }] }),
    source('hydra', 'plants', { plants: [{ id: 1, name: 'Plant 1', soilPercent: 8, online: true, stale: false, soilStale: false, measuredAt: new Date().toISOString() }] }),
    source('weather', 'weather', { temperatureC: 23, condition: 'clear', place: 'Hangzhou' }),
    source('pi', 'sessions', { total: 1, sessions: [{ id: 's1', project: 'Desk', state: 'running' }] }),
    source('futu', 'portfolio', { todayChangePercent: 0.3 }),
  ]
  const scores = { quota: 45, plants: 43, weather: 24, sessions: 22, portfolio: 20 }
  const judge = async facts => facts.map(fact => ({ ...fact, attention: scores[fact.icon] ?? 0 }))
  const result = await generateHomeSelection(readings, { judge, choose: async () => { throw Error('not needed') } })
  assert.deepEqual(result.items.flatMap(item => item.readingIds), ['quota', 'hydra'])
})

test('flat scores still cap the glance at three facts', async () => {
  const readings = [
    source('quota', 'quota', { remainingPercent: 88 }),
    source('hydra', 'plants', { plants: [{ id: 1, name: 'Plant 1', soilPercent: 58, online: true, stale: false, soilStale: false, measuredAt: new Date().toISOString() }] }),
    source('weather', 'weather', { temperatureC: 23, condition: 'clear' }),
    source('pi', 'sessions', { total: 1, sessions: [{ id: 's1', state: 'running' }] }),
    source('futu', 'portfolio', { todayChangePercent: 0.1 }),
  ]
  const scores = { quota: 27, plants: 26, weather: 25, sessions: 22, portfolio: 19 }
  const judge = async facts => facts.map(fact => ({ ...fact, attention: scores[fact.icon] ?? 0 }))
  const result = await generateHomeSelection(readings, { judge, choose: async () => { throw Error('not needed') } })
  const ids = result.items.flatMap(item => item.readingIds)
  assert.equal(ids.length, 3)
  assert.deepEqual(ids, ['quota', 'hydra', 'weather'])
})

test('createOverviewJevJudge assigns attention from Jev noul probabilities', async () => {
  const readings = [
    source('futu', 'portfolio', { todayChangePercent: 2.5 }),
    source('hydra', 'plants', { plants: [{ id: 1, name: 'Plant 1', soilPercent: 12, online: true, stale: false, soilStale: false, measuredAt: new Date().toISOString() }] }),
    source('weather', 'weather', { temperatureC: 24 }),
  ]
  const facts = homeFactVariables(readings).map(fact => ({ ...fact, text: fact.factId.includes('soilPercent') ? 'soil' : fact.id, state: 'live' }))
  const mockClient = async ({ state, questions }) => ({ model: 'jev-1.13-free', answers: Object.fromEntries(Object.keys(questions).map(id => [id,
    { type: 'noul', noul: state.candidates[id].text === 'soil' ? 0.94 : state.candidates[id].text === 'futu' ? 0.88 : 0.28 }])) })

  const judge = createOverviewJevJudge({ client: mockClient })
  const scored = await judge(facts, readings)

  assert.equal(scored.find(f => f.text === 'soil').attention, 94)
  assert.equal(scored.find(f => f.text === 'futu').attention, 88)
  assert.equal(scored.find(f => f.text === 'weather').attention, 28)
})

test('generateHomeSelection incorporates Jev judging to order facts agentically', async () => {
  const readings = [
    source('weather', 'weather', { temperatureC: 24 }),
    source('futu', 'portfolio', { todayChangePercent: 3.2 }),
  ]
  let judged = false
  const mockJudge = async facts => {
    judged = true
    return facts.map(f => ({
      ...f,
      attention: f.icon === 'portfolio' ? 95 : 20,
    }))
  }

  const result = await generateHomeSelection(readings, { choose: async () => { throw Error('Selector not needed after judgment') }, judge: mockJudge })
  assert.equal(judged, true)
  // A 75-point gap is a glance at one thing, not a list.
  assert.deepEqual(result.items[0].readingIds, ['futu'])
})

test('an unresponsive judgment falls back to current local facts within three seconds', async () => {
  let release, observed, selections = 0
  const held = new Promise(resolve => { release = resolve })
  const readings = [source('weather', 'weather', { temperatureC: 24 })]
  const start = performance.now()
  const pending = generateHomeSelection(readings, {
    judge: async (_facts, _readings, { signal }) => { observed = signal; await held; return [] },
    choose: async () => { selections++; throw Error('generation should not run after judgment failure') },
  })
  try {
    const selection = await pending
    assert.ok(performance.now() - start < 4000, 'judgment must not keep Overview waiting')
    assert.equal(observed.aborted, true)
    assert.equal(selections, 0)
    const { resolveHomeTemplate } = await import('../src/home-template.mjs')
    assert.match(resolveHomeTemplate(selection, readings).items[0].text, /24°C/)
  } finally { release() }
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(selections, 0, 'a late judgment cannot start selection')
})

test('an invalid judgment response does not publish a false success', async () => {
  let failure = false
  const readings = [source('weather', 'weather', { temperatureC: 24 })]
  const selection = await generateHomeSelection(readings, {
    judge: async () => [], onJudgmentFailure: () => { failure = true },
    choose: async () => { throw Error('unexpected selector') },
  })
  const { resolveHomeTemplate } = await import('../src/home-template.mjs')
  assert.equal(failure, true)
  assert.match(resolveHomeTemplate(selection, readings).items[0].text, /24°C/)
})

test('a rejected judgment uses local facts without calling the selector', async () => {
  let selections = 0
  const readings = [source('weather', 'weather', { temperatureC: 24 })]
  const selection = await generateHomeSelection(readings, {
    judge: async () => { throw Object.assign(Error('synthetic 429'), { status: 429 }) },
    choose: async () => { selections++; throw Error('unexpected selector') },
  })
  const { resolveHomeTemplate } = await import('../src/home-template.mjs')
  assert.equal(selections, 0)
  assert.match(resolveHomeTemplate(selection, readings).items[0].text, /24°C/)
})

test('Overview cancels a held judgment and never starts selection afterward', async () => {
  const controller = new AbortController()
  let entered, release, signalSeen, selections = 0
  const started = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  const pending = generateHomeSelection([source('weather', 'weather', { temperatureC: 24 })], {
    signal: controller.signal,
    judge: async (_facts, _readings, options) => { signalSeen = options.signal; entered(); await held; return [] },
    choose: async () => { selections++; return { items: [] } },
  })
  await started
  controller.abort()
  try {
    await Promise.race([assert.rejects(pending), new Promise((_resolve, reject) => setTimeout(() => reject(Error('Cancellation did not settle')), 500))])
    assert.equal(signalSeen?.aborted, true)
    assert.equal(selections, 0)
  } finally { release() }
})

test('several judgment batches can complete within the shared deadline', async () => {
  let active = 0, maxActive = 0
  const client = async ({ questions }) => {
    active++; maxActive = Math.max(active, maxActive)
    await new Promise(resolve => setTimeout(resolve, 30))
    active--
    return { answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'noul', noul: 0.5 }])) }
  }
  const facts = Array.from({ length: 65 }, (_, index) => ({ factId: `fact-${index}`, text: 'status', state: 'live', displayable: true }))
  const scored = await createOverviewJevJudge({ client })(facts)
  assert.equal(scored.length, 65)
  assert.ok(maxActive > 1 && maxActive <= 4)
})

test('a failed generation batch aborts sibling selections', async () => {
  const readings = Array.from({ length: 300 }, (_, index) => source(`source-${index}`, 'mail', { subject: `Fixture ${index}` }))
  let entered, release, calls = 0, siblingAborted = false
  const siblingStarted = new Promise(resolve => { entered = resolve })
  const failure = new Promise((_resolve, reject) => { release = () => reject(Error('synthetic selector failure')) })
  const pending = generateHomeSelection(readings, { choose: async (_request, _batch, signal) => {
    if (++calls === 1) { await siblingStarted; return failure }
    entered()
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { siblingAborted = true; reject(signal.reason) }, { once: true }))
  } })
  await siblingStarted
  release()
  await assert.rejects(pending, /synthetic selector failure/)
  assert.equal(siblingAborted, true)
})

test('a busy service cannot crowd other services out of scored selection', async () => {
  const mail = source('mail', 'mail', Object.fromEntries(Array.from({ length: 300 }, (_, index) => [`field${index}`, `message ${index}`])))
  const weather = source('weather', 'weather', { temperatureC: 24 })
  const result = await generateHomeSelection([mail, weather], {
    judge: async facts => facts.map(fact => ({ ...fact, attention: fact.icon === 'weather' ? 80 : 90 })),
    choose: async () => ({ items: [] }),
  })
  assert.deepEqual(result.items.flatMap(item => item.readingIds), ['mail', 'weather'])
})

test('a rejected judgment batch aborts sibling batches', async () => {
  let release, entered, siblingAborted = false
  const siblingStarted = new Promise(resolve => { entered = resolve })
  const failure = new Promise((_resolve, reject) => { release = () => reject(Error('synthetic failure')) })
  let calls = 0
  const client = async ({ signal }) => {
    if (++calls === 1) { await siblingStarted; return failure }
    entered()
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { siblingAborted = true; reject(signal.reason) }, { once: true }))
  }
  const facts = Array.from({ length: 65 }, (_, index) => ({ factId: `fact-${index}`, text: 'status', state: 'live', displayable: true }))
  const pending = createOverviewJevJudge({ client })(facts)
  await siblingStarted
  release()
  await assert.rejects(pending, /synthetic failure/)
  assert.equal(siblingAborted, true)
})

test('a late judgment response cannot start another batch after cancellation', async () => {
  const controller = new AbortController()
  let release, entered, calls = 0
  const ready = new Promise(resolve => { entered = resolve })
  const held = new Promise(resolve => { release = resolve })
  const client = async ({ questions }) => {
    calls++
    entered()
    await held
    return { answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'noul', noul: 0.5 }])) }
  }
  const judge = createOverviewJevJudge({ client })
  const facts = Array.from({ length: 200 }, (_, index) => ({ factId: `fact-${index}`, text: 'status', state: 'live', displayable: true }))
  const pending = judge(facts, [], { signal: controller.signal })
  await ready
  const started = calls
  controller.abort()
  release()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.ok(started <= 4)
  assert.equal(calls, started)
})

test('timed out classification does not disable unrelated Jev judgments', async () => {
  const { createJudgmentClient } = await import('../src/judgment-client.mjs')
  let first = true
  const client = createJudgmentClient({ env: {}, model: () => 'fixture/model', createJev: () => async ({ questions, signal }) => {
    if (first) { first = false; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) }
    return { model: 'jev-latest', answers: Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'noul', noul: 0.9 }])) }
  }, generate: async () => { throw Error('ordinary model should not be needed') } })
  const questions = { q: { type: 'noul', instructions: 'Check' } }
  const pending = client.requestJevOnly({ state: {}, questions, signal: AbortSignal.timeout(15) })
  await assert.rejects(pending)
  const result = await client.request({ state: {}, questions })
  assert.equal(result.model, 'jev-latest')
})

test('a session summary is not dropped when attention has no separate count score', async () => {
  const readings = [source('session', 'sessions', { count: 3 })]
  const result = await generateHomeSelection(readings, {
    judge: async facts => facts.map(fact => ({ ...fact, attention: 80 })),
    choose: async () => ({ items: [] }),
  })
  assert.deepEqual(result.items[0].readingIds, ['session'])
})

test('a failed generation call cannot hide valid ranked source facts', async () => {
  const readings = [source('weather', 'weather', { temperatureC: 24 })]
  const result = await generateHomeSelection(readings, {
    judge: async facts => facts.map(fact => ({ ...fact, attention: 80 })),
    choose: async () => { throw Error('synthetic generation outage') },
  })
  const { resolveHomeTemplate } = await import('../src/home-template.mjs')
  assert.match(resolveHomeTemplate(result, readings).items[0].text, /24°C/)
})

test('a minimum token length bucket remains bounded for empty local text', async () => {
  const readings = [source('empty', 'mail', { subject: '' })]
  let request
  await generateHomeSelection(readings, { choose: async value => { request = value; return { items: [{ sources: [0] }] } } })
  assert.ok(request.variables[0].characters >= 32)
})

test('a selector cannot discard the most important scored fact', async () => {
  const readings = [source('weather', 'weather', { temperatureC: 24 }), source('portfolio', 'portfolio', { todayChangePercent: 2 })]
  const result = await generateHomeSelection(readings, {
    judge: async facts => facts.map(fact => ({ ...fact, attention: fact.icon === 'portfolio' ? 90 : 10 })),
    choose: async request => ({ items: [{ sources: [request.variables.find(fact => fact.icon === 'weather').selector] }] }),
  })
  assert.equal(result.items[0].readingIds[0], 'portfolio')
})

test('higher scored facts cannot be displaced by a low scored selection', async () => {
  const readings = [source('first', 'mail', { subject: 'First' }), source('second', 'reading', { title: 'Second' }), source('third', 'weather', { temperatureC: 24 })]
  const result = await generateHomeSelection(readings, {
    judge: async facts => facts.map((fact, index) => ({ ...fact, attention: [99, 98, 1][index] })),
    choose: async request => ({ items: [{ sources: [request.variables.find(fact => fact.icon === 'weather').selector] }] }),
  })
  assert.deepEqual(result.items.flatMap(item => item.readingIds).slice(0, 2), ['first', 'second'])
})

test('selected facts follow judgment order even when the selector reverses them', async () => {
  const readings = [source('weather', 'weather', { temperatureC: 24 }), source('portfolio', 'portfolio', { todayChangePercent: 2 }),
    source('pi', 'sessions', { total: 1, sessions: [{ id: 's1', state: 'running' }] })]
  const result = await generateHomeSelection(readings, {
    judge: async facts => facts.map(fact => ({ ...fact, attention: fact.icon === 'portfolio' ? 90 : fact.icon === 'weather' ? 84 : 10 })),
    choose: async request => ({ items: [{ sources: [request.variables.find(fact => fact.icon === 'weather').selector,
      request.variables.find(fact => fact.icon === 'portfolio').selector] }] }),
  })
  assert.deepEqual(result.items[0].readingIds, ['portfolio', 'weather'])
})

test('Overview ranks facts across more than one judgment batch', async () => {
  const readings = Array.from({ length: 260 }, (_, index) => source(`source-${index}`, 'mail', { subject: `Private ${index}` }))
  const batchSizes = []
  const client = async ({ state, questions }) => {
    batchSizes.push(Object.keys(questions).length)
    const answers = Object.fromEntries(Object.keys(questions).map(id => [id, { type: 'noul', noul: state.candidates[id].text.includes('special') ? 0.99 : 0.1 }]))
    return { model: 'jev-1.13-free', answers }
  }
  const judge = createOverviewJevJudge({ client })
  const result = await generateHomeSelection(readings, { judge: async (facts, sources, options) => {
    facts.at(-1).text += ' special'
    return judge(facts, sources, options)
  }, choose: async () => { throw Error('Selector not needed after judgment') } })
  assert.ok(batchSizes.length >= 2)
  assert.ok(batchSizes.every(size => size <= 256))
  assert.equal(batchSizes.reduce((sum, size) => sum + size, 0), 260)
  assert.equal(result.items[0].readingIds[0], 'source-259')
})

test('Jev client supports OpenCode Zen provider and jev-free model alias', async () => {
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const runtime = await ModelRuntime.create({ modelsPath: null, allowModelNetwork: false, refreshOnCreate: false,
    credentials: { read: async () => undefined, list: async () => [], modify: async () => { throw Error('Read only fixture') }, delete: async () => { throw Error('Read only fixture') } } })
  runtime.registerProvider('opencode', { baseUrl: 'https://magpie.local/v1/systemone' })

  let requestedUrl = null
  const fetchImpl = async (url, options) => {
    requestedUrl = String(url)
    return Response.json({
      model: 'jev-1.13-free',
      answers: { test: { type: 'noul', noul: 0.85 } },
    })
  }

  const client = createJevClient({
    runtime,
    env: {
      ODK_JEV_PROVIDER: 'opencode-zen',
      ODK_JEV_MODEL: 'jev-free',
      ODK_JEV_BASE_URL: 'https://magpie.local/v1/systemone',
      OPENCODE_API_KEY: 'test-zen-key',
    },
    fetchImpl,
  })

  const result = await client({
    state: {},
    questions: { test: { type: 'noul', instructions: 'Is this important?', criteria: { true: 'yes', false: 'no' } } },
  })

  assert.equal(requestedUrl, 'https://magpie.local/v1/systemone')
  assert.equal(result.model, 'jev-1.13-free')
  assert.equal(result.answers.test.noul, 0.85)
})

test('equal scores keep facts in numeric order, not string order', async () => {
  const readings = Array.from({ length: 12 }, (_, index) => source(`s${index}`, 'mail', { subject: `Fixture ${index}` }))
  const result = await generateHomeSelection(readings, {
    judge: async facts => facts.map(fact => ({ ...fact, attention: 40 })),
    choose: async () => { throw Error('not needed') },
  })
  assert.deepEqual(result.items.flatMap(item => item.readingIds), ['s0', 's1', 's2'])
})
