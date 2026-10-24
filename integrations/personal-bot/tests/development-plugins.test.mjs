import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, realpath, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPersonalBotComposition, personalBotManifest, BOT_PORTS } from '../src/plugin-composition.mjs'
import { loadPersonalBotReplacements } from '../src/development-plugins.mjs'
import { PersonalBotService } from '../src/service.mjs'
import { sessionAdapter } from '../src/agent.mjs'
import { transcribe } from '../src/transcribe.mjs'
import { HomeBriefing } from '../src/home-briefing.mjs'
import { ProactiveWatch } from '../src/proactive.mjs'
import { proposalStateStore } from '../src/proactive-state.mjs'
import { protectProactivePath } from '../src/proactive-private.mjs'
import { fixtureJudge } from './helpers/proactive-judge.mjs'
import { createRequire } from 'node:module'

async function selection(t, name, source) {
  const dir = await mkdtemp(join(tmpdir(), 'bot-plugins-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const entry = join(dir, 'entry.cjs')
  const config = join(dir, 'selection.json')
  await writeFile(entry, source)
  await writeFile(config, JSON.stringify({ schemaVersion: 1, replacements: [{ manifest: { ...personalBotManifest(name), version: '2.0.0' }, entry }] }))
  return { dir, config, entry }
}

function composition(replacementPlugins, events = []) {
  return createPersonalBotComposition({ replacementPlugins,
    createService: () => ({ close() { events.push('service.close') } }),
    openChannel: async () => ({ close() { events.push('channel.close') } }),
    initialize: async () => ({ agent: { abort() { events.push('agent.abort') }, close() { events.push('agent.close') } } }),
    createHome: () => ({ start() {}, close() {} }),
    createWatch: () => ({ start() {}, close() {} }),
    createTaskReadings: () => ({ list: () => [], read: () => null }),
    createRemoteReadings: () => ({ list: () => [], read: () => null }),
  })
}

test('external Agent runtime preserves actual service responses, errors, and restart', async t => {
  const selected = await selection(t, 'runtime', `exports.create = () => ({
    stt: { url: 'http://127.0.0.1:5011/inference', model: 'selected-stt', language: 'auto', prompt: 'selected context' },
    agent: {
    prompt: async (text, snapshot) => {
      if (text === 'fail') throw Error('private provider detail')
      snapshot('Result: ' + text)
      return 'Result: ' + text
    }, abort() {}, close() {}
  } })`)
  const audio = join(selected.dir, 'synthetic.wav')
  const bytes = Buffer.from('synthetic-audio')
  await writeFile(audio, bytes)
  const reports = []
  for (const external of [false, true]) {
    const states = []
    let runtime
    let transcript = 'hello'
    let cleaned = 0
    let initialized = 0
    let requests = 0
    const service = new PersonalBotService({
      record: async () => ({ stop: async () => audio, done: new Promise(() => {}), cleanup: async () => { cleaned++ } }),
      transcribe: (path, signal) => transcribe(path, runtime.stt, signal, async (url, options) => {
        requests++
        assert.equal(url, external ? 'http://127.0.0.1:5011/inference' : 'http://127.0.0.1:5010/inference')
        assert.equal(options.body.get('model'), external ? 'selected-stt' : 'default-stt')
        assert.equal(options.body.get('prompt'), external ? 'selected context' : 'default context')
        assert.equal(options.body.get('language'), 'auto')
        assert.equal(options.body.get('translate'), 'false')
        assert.deepEqual(options.headers, {})
        assert.deepEqual(Buffer.from(await options.body.get('file').arrayBuffer()), bytes)
        return Response.json({ text: transcript })
      }, {}),
      prompt: (text, snapshot) => runtime.agent.prompt(text, snapshot),
    })
    service.subscribe(frame => states.push({ state: frame.state, message: frame.message, transcript: frame.transcript }))
    const resident = createPersonalBotComposition({
      replacementPlugins: external ? loadPersonalBotReplacements(selected.config, { trusted: true }) : [],
      createService: () => service,
      openChannel: async () => ({ close() {} }),
      initialize() {
        assert.equal(external, false, 'selected runtime must not construct the default adapter')
        initialized++
        let listener
        return { stt: { url: 'http://127.0.0.1:5010/inference', model: 'default-stt', language: 'auto', prompt: 'default context' },
          agent: sessionAdapter({
          subscribe(callback) { listener = callback; return () => { listener = undefined } },
          async prompt(text) {
            assert.ok(text.startsWith('Personal Bot request:\n'))
            const request = text.slice('Personal Bot request:\n'.length)
            if (request === 'fail') throw Error('private provider detail')
            listener({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop',
              content: [{ type: 'text', text: 'Result: ' + request }] } })
          }, abort() {}, dispose() {},
        }) }
      },
      onRuntime(value) { runtime = value },
    })
    try {
      await resident.start()
      const channel = resident.port(BOT_PORTS.channel)
      const first = runtime
      assert.equal(resident.catalog().find(entry => entry.manifest.id === 'odk.personal-bot.runtime').manifest.version, external ? '2.0.0' : '1.0.0')
      for (const text of ['hello', 'fail']) {
        transcript = text
        await service.toggle()
        await service.toggle()
      }
      await resident.setEnabled('odk.personal-bot.runtime', false)
      assert.equal(runtime, undefined)
      assert.equal(resident.port(BOT_PORTS.service), service)
      assert.equal(resident.port(BOT_PORTS.channel), channel)
      await service.toggle()
      assert.equal(cleaned, 2)
      await resident.setEnabled('odk.personal-bot.runtime', true)
      assert.notEqual(runtime, first)
      transcript = 'again'
      await service.toggle()
      await service.toggle()
      assert.equal(cleaned, 3)
      assert.equal(requests, 3)
      assert.equal(service.status.message, 'Result: again')
      assert.equal(initialized, external ? 0 : 2)
      reports.push([...states])
    } finally { await resident.stop() }
  }
  assert.deepEqual(reports[1], reports[0])
  assert.deepEqual(reports[0].filter(frame => ['idle', 'error'].includes(frame.state)).map(frame => frame.message),
    ['Result: hello', 'Personal Bot request failed; try again', '', 'Result: again'])
})

test('default and external runtime disable settle pending voice work and fence released callbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const selected = await selection(t, 'runtime', `exports.create = () => {
    let entered, reject, snapshot
    const ready = new Promise(resolve => { entered = resolve })
    return { ready, late(text) { snapshot?.(text) }, agent: {
      async prompt(text, callback) {
        if (text === 'hold') {
          snapshot = callback; entered()
          await new Promise((_resolve, rejectRequest) => { reject = rejectRequest })
        }
        return 'Result: ' + text
      }, abort() { reject?.(Error('cancelled')) }, close() {}
    } }
  }`)
  const outcomes = []
  for (const external of [false, true]) {
    let runtime, transcript = 'hold', cleaned = 0
    const states = []
    const service = new PersonalBotService({
      record: async () => ({ stop: async () => 'synthetic-input', done: new Promise(() => {}), cleanup: async () => { cleaned++ } }),
      transcribe: async () => transcript,
      prompt: (text, snapshot) => runtime.agent.prompt(text, snapshot),
    })
    service.subscribe(frame => states.push(frame))
    const resident = createPersonalBotComposition({
      replacementPlugins: external ? loadPersonalBotReplacements(selected.config, { trusted: true }) : [],
      createService: () => service, openChannel: async () => ({ close() {} }),
      initialize() {
        assert.equal(external, false, 'selected runtime must not construct the default adapter')
        let entered, reject, listener, captured
        const ready = new Promise(resolve => { entered = resolve })
        const frame = text => ({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text }] } })
        return { ready, late(text) { captured?.(frame(text)) }, agent: sessionAdapter({
          subscribe(callback) { listener = callback; return () => { listener = undefined } },
          async prompt(text) {
            const request = text.slice('Personal Bot request:\n'.length)
            if (request === 'hold') {
              captured = listener; entered()
              await new Promise((_resolve, rejectRequest) => { reject = rejectRequest })
            }
            listener(frame('Result: ' + request))
          }, abort() { reject?.(Error('cancelled')) }, dispose() {},
        }) }
      }, onRuntime(value) { runtime = value },
    })
    try {
      await resident.start()
      const channel = resident.port(BOT_PORTS.channel)
      const first = runtime
      await service.toggle()
      const pending = service.toggle()
      await first.ready
      await resident.setEnabled('odk.personal-bot.runtime', false)
      await pending
      assert.equal(runtime, undefined)
      assert.equal(service.closed, true)
      assert.equal(cleaned, 1)
      assert.equal(resident.port(BOT_PORTS.service), service)
      assert.equal(resident.port(BOT_PORTS.channel), channel)
      const count = states.length
      first.late('released output')
      t.mock.timers.tick(100)
      assert.equal(states.length, count)
      assert.equal(service.status.message, '')
      await resident.setEnabled('odk.personal-bot.runtime', true)
      assert.notEqual(runtime, first)
      assert.equal(service.closed, false)
      transcript = 'after'
      await service.toggle()
      await service.toggle()
      const resumed = states.length
      first.late('old output after resume')
      t.mock.timers.tick(100)
      assert.equal(states.length, resumed)
      assert.equal(cleaned, 2)
      assert.equal(service.status.message, 'Result: after')
      outcomes.push({ state: service.status.state, message: service.status.message, transcript: service.status.transcript, cleaned })
    } finally {
      runtime?.agent.abort()
      await resident.stop()
    }
  }
  assert.deepEqual(outcomes[1], outcomes[0])
})

for (const name of Object.keys(BOT_PORTS)) {
  test(`external ${name} factory supplies the actual resident port`, async t => {
    const selected = await selection(t, name, `exports.create = ctx => ({ selected: '${name}', close() { return '${name}' }, start() {}, list() { return [] }, read() { return null }, agent: { abort() {}, close() {} } })`)
    const replacements = loadPersonalBotReplacements(selected.config, { trusted: true })
    const resident = composition(replacements)
    await resident.start()
    if (name === 'channel') assert.equal(await resident.port(BOT_PORTS.channel).close(), name)
    else assert.equal(resident.port(BOT_PORTS[name]).selected, name)
    assert.equal(resident.catalog().find(item => item.manifest.id === `odk.personal-bot.${name}`).manifest.version, '2.0.0')
    await resident.stop()
  })
}

test('independent selected Home preserves service pushes, unavailable readings, recovery, and restart', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const selected = await selection(t, 'home', `exports.create = ctx => {
    const provider = require('./readings.cjs')
    const service = ctx.get('${BOT_PORTS.service}')
    let timer, interval
    const home = {
      closed: false, pending: null, controller: null,
      frame: { state: 'unavailable', items: [], generatedAt: 0, omittedSources: 0 },
      publish(state, extra = {}) {
        if (home.closed) return
        const coverage = Object.hasOwn(extra, 'items') ? home.coverage : home.frame.coverage || home.coverage
        home.frame = { ...home.frame, state, ...extra }
        if (coverage) home.frame.coverage = { ...coverage, selectedSources: new Set(home.frame.items.flatMap(item => item.sources.map(source => source.id))).size }
        service.publishBriefing(home.frame)
      },
      refresh() {
        if (home.closed) return Promise.resolve()
        if (home.pending) return home.pending
        home.controller = new AbortController()
        home.pending = (async () => {
          try {
            const catalog = await provider.read(home.controller.signal)
            if (home.closed) return
            const readings = catalog.filter(source => source.home.mode !== 'hidden').map(source => {
              let next = { ...source, value: source.value && Object.fromEntries(source.home.fields.filter(field => field in source.value).map(field => [field, source.value[field]])) }
              if (Buffer.byteLength(JSON.stringify(next)) > 65536) next = { ...next, state: 'error', value: null }
              return next
            })
            const partial = value => typeof value === 'string' ? value.length > 8192 : Boolean(value && typeof value === 'object' && Object.values(value).some(partial))
            home.coverage = { totalSources: readings.length, readSources: readings.length,
              failedSources: readings.filter(source => source.state !== 'live').length, incompleteSources: readings.filter(source => partial(source.value)).length }
            const omittedSources = catalog.filter(source => source.home.mode !== 'hidden').length - readings.length
            if (!readings.length) { home.publish('empty', { items: [], generatedAt: provider.now(), omittedSources }); return }
            home.publish('loading')
            const items = [readings.slice(0, 4), readings.slice(4)].filter(group => group.length).map(group => {
              const segments = group.flatMap((source, index) => {
                const text = source.state !== 'live' ? source.label + ' is ' + source.state
                  : source.home.icon === 'weather' ? source.label + ' ' + source.value.temperatureC + '°C'
                    : source.label + ' ' + source.value.count + ' sessions'
                return [...(index ? [{ text: ' and ' }] : []), { text, icon: source.home.icon }]
            })
              segments.push({ text: '.' })
              return { text: segments.map(segment => segment.text).join(''), segments,
                sources: group.map(source => ({ id: source.id, label: source.label, state: source.state, ...(Number.isFinite(source.updatedAt) ? { updatedAt: source.updatedAt } : {}) })) }
            })
            home.publish('live', { items, generatedAt: provider.now(), omittedSources })
          } catch { home.publish(home.frame.items.length ? 'stale' : 'error') }
        })().finally(() => { home.pending = null })
        return home.pending
      },
      start() { interval = setInterval(() => { void home.refresh() }, 60000); void home.refresh() },
      invalidate() { if (!home.closed) { clearTimeout(timer); timer = setTimeout(() => { void home.refresh() }, 1000) } },
      close() { home.closed = true; home.controller?.abort(); clearTimeout(timer); clearInterval(interval) },
    }
    return home
  }`)
  const input = join(selected.dir, 'readings.json')
  const providerFile = join(selected.dir, 'readings.cjs')
  await writeFile(providerFile, `const fs = require('node:fs/promises')
    exports.read = async signal => JSON.parse(await fs.readFile(__dirname + '/readings.json', { encoding: 'utf8', signal }))`)
  const { createRequire } = await import('node:module')
  const provider = createRequire(import.meta.url)(providerFile)
  const read = provider.read
  const reading = (count, state = 'live') => ({ id: 'pi', label: 'Pi', state, updatedAt: 1000,
    value: state === 'live' ? { count } : null,
    home: { mode: 'required', priority: 100, icon: 'sessions', fields: ['count'] } })
  const reports = []
  for (const external of [false, true]) {
    await writeFile(input, JSON.stringify([reading(2)]))
    let generations = 0, releasePending = () => {}, now = 2000
    provider.now = () => now
    const service = new PersonalBotService({ record: async () => assert.fail('no capture'),
      transcribe: async () => assert.fail('no transcription'), prompt: async () => assert.fail('no voice request') })
    const resident = createPersonalBotComposition({
      replacementPlugins: external ? loadPersonalBotReplacements(selected.config, { trusted: true }) : [],
      createService: () => service, openChannel: async () => ({ close() {} }),
      initialize: () => ({ agent: { abort() {}, close() {} } }),
      createHome() {
        assert.equal(external, false, 'selected Home must not construct the default implementation')
        return new HomeBriefing({ requireBindings: true, list: signal => provider.read(signal),
          read: async (id, signal) => (await provider.read(signal)).find(source => source.id === id),
          generate: async ({ readings }) => {
            generations++
            return { items: [readings.slice(0, 4), readings.slice(4)].filter(group => group.length).map(group => {
              const segments = group.flatMap((source, index) => {
                const label = '{{' + source.id + '|@label|text}}'
                const text = source.state !== 'live' ? label + ' is {{' + source.id + '|@state|text}}'
                  : source.home.icon === 'weather' ? label + ' {{' + source.id + '|temperatureC|celsius}}'
                    : label + ' {{' + source.id + '|count|integer}} sessions'
                return [...(index ? [{ text: ' and ' }] : []), { text, icon: source.home.icon }]
              })
              segments.push({ text: '.' })
              return { text: segments.map(segment => segment.text).join(''), segments, readingIds: group.map(source => source.id) }
            }) }
          }, publish: frame => service.publishBriefing(frame), now: () => now })
      },
      onHome(home, current, context) { current.attachHome(home); context.onCleanup(() => current.attachHome(undefined)) },
    })
    const snapshots = []
    const push = async (predicate, elapsed = 15 * 60 * 1000) => {
      now += elapsed
      const published = new Promise(resolve => {
        const off = service.subscribe(frame => { if (predicate(frame.briefing)) { off(); resolve() } })
      })
      service.servicePush(['pi'])
      t.mock.timers.tick(1000)
      await published
      snapshots.push(structuredClone(service.status.briefing))
    }
    try {
      await resident.start()
      const first = resident.port(BOT_PORTS.home), runtime = resident.port(BOT_PORTS.runtime), channel = resident.port(BOT_PORTS.channel)
      await first.refresh()
      assert.equal(service.status.briefing.items[0].text, 'Pi 2 sessions.')
      snapshots.push(structuredClone(service.status.briefing))
      await writeFile(input, JSON.stringify([reading(5)]))
      await push(frame => frame?.state === 'live' && frame.items[0]?.text === 'Pi 5 sessions.', 5 * 60 * 1000)
      assert.equal(generations, external ? 0 : 1)
      const pi = reading(5)
      pi.home.priority = 10
      pi.value.private_note = 'excluded private field'.repeat(1000)
      const hidden = { ...reading(99), id: 'hidden', label: 'Hidden', home: { ...pi.home, mode: 'hidden', priority: 100 } }
      const secondary = { ...reading(4), id: 'secondary', label: 'Secondary', home: { ...pi.home, mode: 'optional', priority: 80 } }
      const omitted = { ...reading(8), id: 'omitted', label: 'Omitted', home: { ...pi.home, mode: 'optional', priority: 70 } }
      const weather = { id: 'weather', label: 'Weather', state: 'live', updatedAt: 1000, value: { temperatureC: 25 },
        home: { mode: 'optional', priority: 90, icon: 'weather', fields: ['temperatureC'] } }
      await writeFile(input, JSON.stringify([omitted, hidden, secondary, weather, pi]))
      await push(frame => frame?.state === 'live')
      assert.deepEqual(service.status.briefing.items.flatMap(item => item.sources.map(source => source.id)), ['omitted', 'secondary', 'weather', 'pi'])
      assert.equal(service.status.briefing.items[0].text, 'Omitted 8 sessions and Secondary 4 sessions and Weather 25°C and Pi 5 sessions.')
      assert.equal(service.status.briefing.omittedSources, 0)
      assert.doesNotMatch(JSON.stringify(service.status.briefing), /Hidden|excluded private field/)
      const sizedReading = (size, mode) => {
        const source = reading(6)
        source.home = { ...source.home, mode, fields: ['count', 'padding'] }
        source.value.padding = ''
        const extra = size - Buffer.byteLength(JSON.stringify(source))
        source.value.padding = '界'.repeat(Math.floor(extra / 3)) + 'x'.repeat(extra % 3)
        assert.equal(Buffer.byteLength(JSON.stringify(source)), size)
        return source
      }
      await writeFile(input, JSON.stringify([sizedReading(65536, 'required')]))
      await push(frame => frame?.state === 'live')
      assert.equal(service.status.briefing.items[0].text, 'Pi 6 sessions.')
      assert.equal(service.status.briefing.items[0].sources[0].state, 'live')
      assert.equal(service.status.briefing.omittedSources, 0)
      await writeFile(input, JSON.stringify([sizedReading(65537, 'required')]))
      await push(frame => frame?.state === 'live')
      assert.equal(service.status.briefing.items[0].text, 'Pi is error.')
      assert.deepEqual(service.status.briefing.items[0].sources, [{ id: 'pi', label: 'Pi', state: 'error', updatedAt: 1000 }])
      assert.equal(service.status.briefing.omittedSources, 0)
      const oversizedOptional = { ...sizedReading(65537, 'optional'), id: 'optional' }
      await writeFile(input, JSON.stringify([reading(6), oversizedOptional]))
      await push(frame => frame?.state === 'live')
      assert.equal(service.status.briefing.items[0].text, 'Pi 6 sessions and Pi is error.')
      assert.deepEqual(service.status.briefing.items[0].sources.map(source => source.id), ['pi', 'optional'])
      assert.equal(service.status.briefing.omittedSources, 0)
      const aggregate = Array.from({ length: 7 }, (_, index) => {
        const source = sizedReading(index === 6 ? 300 : 8000, 'required')
        source.id = 'p' + index
        source.label = 'P' + index
        return source
      })
      await writeFile(input, JSON.stringify(aggregate))
      await push(frame => frame?.state === 'live')
      const boundedSources = service.status.briefing.items.flatMap(item => item.sources)
      assert.deepEqual(boundedSources.map(source => source.id), aggregate.map(source => source.id))
      assert.deepEqual(boundedSources.map(source => source.state), Array(7).fill('live'))
      assert.equal(service.status.briefing.omittedSources, 0)
      await writeFile(input, JSON.stringify([reading(0, 'unavailable')]))
      await push(frame => frame?.state === 'live' && frame.items[0]?.text === 'Pi is unavailable.')
      await writeFile(input, '{private invalid reading detail')
      await push(frame => frame?.state === 'stale')
      assert.doesNotMatch(JSON.stringify(service.status), /private invalid reading detail/)
      await writeFile(input, JSON.stringify([reading(7)]))
      await push(frame => frame?.state === 'live' && frame.items[0]?.text === 'Pi 7 sessions.')
      await resident.setEnabled('odk.personal-bot.home', false)
      const disabled = structuredClone(service.status)
      await writeFile(input, JSON.stringify([reading(9)]))
      service.servicePush(['pi'])
      await first.refresh()
      assert.deepEqual(service.status, disabled)
      assert.equal(resident.port(BOT_PORTS.runtime), runtime)
      assert.equal(resident.port(BOT_PORTS.service), service)
      assert.equal(resident.port(BOT_PORTS.channel), channel)
      await resident.setEnabled('odk.personal-bot.home', true)
      const fresh = resident.port(BOT_PORTS.home)
      assert.notEqual(fresh, first)
      await fresh.refresh()
      assert.equal(service.status.briefing.items[0].text, 'Pi 9 sessions.')
      snapshots.push(structuredClone(service.status.briefing))
      let enter, cancelled = false
      const ready = new Promise(resolve => { enter = resolve })
      provider.read = signal => new Promise((resolve, reject) => {
        releasePending = () => resolve([reading(999)])
        signal?.addEventListener('abort', () => { cancelled = true; reject(Error('cancelled reading')) }, { once: true })
        enter()
      })
      const pending = fresh.refresh()
      await ready
      await resident.setEnabled('odk.personal-bot.home', false)
      assert.equal(cancelled, true)
      await pending
      provider.read = read
      await resident.setEnabled('odk.personal-bot.home', true)
      await resident.port(BOT_PORTS.home).refresh()
      const current = structuredClone(service.status)
      releasePending()
      await Promise.resolve()
      assert.deepEqual(service.status, current)
      assert.equal(service.status.briefing.items[0].text, 'Pi 9 sessions.')
      snapshots.push(structuredClone(service.status.briefing))
      reports.push(snapshots)
    } finally { provider.read = read; releasePending(); await resident.stop() }
  }
  assert.deepEqual(reports[1], reports[0])
})

test('independent generated Watch preserves advice and checkpoint identity', { timeout: process.platform === 'win32' ? 300000 : 15000 }, async t => {
  // The separate Watch owns one non-routine owner goal. Only batch validation is shared.
  const selected = await selection(t, 'watch', `const { randomUUID } = require('node:crypto')
exports.create = async context => {
  const options = require('./generated-inputs.cjs').options
  const { validateGeneratedBatch } = await import(options.validationModule)
  const service = context.get('odk:personal-bot/service/v1')
  const runtime = context.get('odk:personal-bot/runtime/v1')
  const rule = options.config.rules[0], observation = rule.observations[0]
  const controller = new AbortController()
  const proposals = structuredClone(options.loadState().proposals)
  const watch = {
    closed: false, proposals, lastAttentionAt: 0,
    list() { return structuredClone(proposals) },
    emit(interaction = false) {
      if (this.closed) return
      const q = options.config.quietHours
      const parts = q ? Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: q.timeZone,
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(options.now()).map(p => [p.type, p.value])) : null
      const time = parts ? parts.hour + ':' + parts.minute : ''
      const quiet = q && q.start !== q.end && (q.start < q.end ? time >= q.start && time < q.end : time >= q.start || time < q.end)
      const automatic = rule.delivery !== 'silent' && (!quiet || rule.urgent)
      const eligible = proposals.filter(p => p.status === 'pending' && (interaction || (!p.offered && automatic && options.now() - this.lastAttentionAt >= 60000))).slice(0, options.config.maxPush)
      const popup = !this.error && eligible.length > 0
      if (popup) { for (const p of eligible) p.offered = true; if (!interaction) this.lastAttentionAt = options.now() }
      const display = this.list()
      options.saveState({ version: 1, proposals: this.list() })
      service.propose({ proposals: display, popup, interaction, hiddenCount: 0, ...(this.error ? { error: this.error } : {}) })
    },
    async tick() {
      if (this.closed) return
      const reading = await options.read(observation.readingId, controller.signal)
      if (this.closed) return
      if (reading.state !== 'live') { this.emit(); return }
      const evidence = observation.fields.map((field, i) => ({ id: 'e' + i, readingId: reading.id, field,
        value: reading.value[field], state: 'live', measuredAt: reading.value.measured_at, ruleId: rule.id }))
      const actions = rule.actions.filter(action => runtime.agent.canExecuteProposal?.({ tool: action.tool, params: action.params }) === true)
      const topics = [{ id: rule.id, goal: rule.goal, evidence, actions: actions.map(({ id, label }) => ({ id, label })) }]
      let candidates
      try {
        const raw = await runtime.agent.generateProposals({ topics, maxCandidates: options.config.maxCandidates,
          trigger: { kind: 'heartbeat', readingIds: [] }, signal: controller.signal })
        if (this.closed) return
        candidates = validateGeneratedBatch(raw, topics, options.config.maxCandidates)
      } catch {
        if (!this.closed) { this.error = '建议生成暂不可用；不会回退为固定建议或执行动作。'; this.emit() }
        return
      }
      const judged = await options.judge({ candidates: candidates.map((c, i) => ({ ...c, id: 'c' + i,
        generated: true, goal: rule.goal, ruleId: rule.id, criteria: [] })), signal: controller.signal })
      if (this.closed) return
      const accepted = candidates.map((c, i) => ({ ...c, answer: judged.answers['c' + i] }))
        .filter(c => c.answer.probability >= c.answer.threshold && c.answer.groundingProbability >= c.answer.threshold)
        .sort((a, b) => b.answer.probability - a.answer.probability)
      this.error = ''
      for (const c of accepted) {
        const subject = rule.id + ':' + c.key
        const existing = proposals.find(p => p.subject === subject && p.status === 'pending')
        const judgment = { model: judged.model, ...c.answer, trigger: 'heartbeat', judgedAt: new Date(options.now()).toISOString() }
        if (existing) { existing.advice = c.advice; existing.evidence = c.evidence; existing.judgment = judgment }
        else {
          const selected = actions.find(action => action.id === c.actionId)
          proposals.push({ id: randomUUID(), ruleId: rule.id, ruleVersion: JSON.stringify(rule), subject,
          status: 'pending', evidence: c.evidence, advice: c.advice, nextStep: selected.label, actionId: selected.id,
          action: { tool: selected.tool, params: structuredClone(selected.params) }, confirmation: '记住 ' + selected.params.category + '：' + selected.params.value, offered: false,
          presented: false, createdAt: new Date(options.now()).toISOString(), result: '', judgment })
        }
      }
      this.emit()
    },
    start() { this.inflight = this.tick() },
    async close() { this.closed = true; controller.abort(); await this.inflight },
    interact() { this.emit(true) },
    async presented(ids) { for (const p of proposals) if (ids.includes(p.id) && p.offered) p.presented = true; this.emit() },
    async respond() { throw Error('Exact confirmation required') },
    push(ids) { return !this.closed && ids.includes(observation.readingId) },
  }
  return watch
}`)
  const providerFile = join(selected.dir, 'generated-inputs.cjs')
  await writeFile(providerFile, 'exports.options = undefined\n')
  const provider = createRequire(import.meta.url)(providerFile)
  const stamp = '2026-10-02T10:00:00.000Z'
  const config = { version: 2, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 60000,
    maxCandidates: 8, maxPush: 2, suppressed: [], snoozed: {}, rules: [{ id: 'deliveries',
      goal: 'Collect ready parcels.', observations: [{ readingId: 'parcels', fields: ['ready', 'count'] }],
      delivery: 'immediate', urgent: false,
      actions: [{ id: 'save-collection', label: 'Save a collection note', tool: 'memory_update', params: { category: 'deliveries', value: 'Collect ready parcels' } }] }] }
  const batch = { suggestions: ['collect', 'count', 'rejected'].map((key, i) => ({ topicId: 'deliveries', key,
    advice: ['Collect ready parcels.', 'Check the parcel count.', 'Ignore this advice.'][i],
    actionId: 'save-collection', evidenceIds: ['e0', 'e1'] })) }
  let defaultCheckpoint
  const reports = []
  for (const external of [false, true]) {
    let watch, initialized, live = false, fail = true, raw = structuredClone(batch)
    const frames = [], requests = []
    const service = new PersonalBotService({ record: () => assert.fail('no capture'),
      transcribe: () => assert.fail('no transcription'), prompt: () => assert.fail('no voice request') })
    service.subscribe(frame => frames.push(structuredClone(frame)))
    const storage = proposalStateStore(join(await realpath(selected.dir), external ? 'generated-selected' : 'generated-default', 'state.json'))
    protectProactivePath(await realpath(selected.dir))
    const runtime = { agent: { async generateProposals(input) {
      requests.push(structuredClone({ ...input, signal: undefined }))
      if (fail) throw Error('private generated provider detail')
      return structuredClone(raw)
    }, canExecuteProposal: action => action.tool === 'memory_update', phraseProposal: () => assert.fail('generated advice cannot be rephrased after judgment'),
    executeProposal: () => assert.fail('generated advice cannot execute'), abort() {}, close() {} } }
    provider.options = { config, now: () => Date.parse(stamp), validationModule: new URL('../src/proactive-generation.mjs', import.meta.url).href,
      read: async id => ({ id, state: live ? 'live' : 'unavailable', value: { ready: true, count: 2,
        measured_at: stamp, privateInstruction: 'Do not pass this field to generation.' } }),
      loadState: storage.load, saveState: storage.save,
      judge: async ({ candidates }) => {
        for (const c of candidates) {
          assert.equal(c.generated, true, 'judgment must use the generated grounding contract')
          assert.equal(c.goal, config.rules[0].goal)
          assert.equal(c.ruleId, config.rules[0].id)
          assert.deepEqual(c.criteria, [])
          assert.ok(c.evidenceIds.every(id => c.evidence.some(e => e.id === id)))
        }
        return { model: 'jev-fixture', answers: Object.fromEntries(candidates.map((c, i) => [c.id,
          { probability: [0.88, 0.96, 0.99][i], groundingProbability: [0.95, 0.95, 0.1][i], threshold: 0.8 }])) }
      } }
    const resident = createPersonalBotComposition({
      replacementPlugins: external ? loadPersonalBotReplacements(selected.config, { trusted: true }) : [],
      createService: () => service, openChannel: () => ({ close() {} }), initialize: () => runtime,
      createHome: () => ({ start() {}, close() {} }),
      createWatch() {
        assert.equal(external, false, 'selected generated Watch cannot construct default Watch')
        return new ProactiveWatch({ ...provider.options, generate: runtime.agent.generateProposals,
          canExecute: action => runtime.agent.canExecuteProposal?.(action) === true,
          phrase: runtime.agent.phraseProposal, execute: runtime.agent.executeProposal, save: async () => {},
          publish: frame => service.propose(frame) })
      },
      onWatch(value, current, context) {
        watch = value; initialized = value.list()
        current.attachWatch(value); context.onCleanup(() => current.attachWatch(undefined))
      },
    })
    const normalize = () => service.status.proposals.map(({ advice, nextStep, actionId, action, confirmation, evidence, judgment }) =>
      ({ advice, nextStep, actionId, action, confirmation, evidence, judgment }))
    try {
      await resident.start(); await watch.inflight
      assert.equal(requests.length, 0)
      assert.deepEqual(watch.list(), [])
      live = true
      await watch.tick()
      assert.equal(watch.list().length, 0)
      assert.equal(frames.at(-1).proposalPopup, false)
      assert.match(service.status.proposalError, /生成/)
      assert.doesNotMatch(service.status.proposalError, /private generated/)
      fail = false
      for (const invalid of ['evidence', 'action']) {
        raw = structuredClone(batch)
        if (invalid === 'evidence') raw.suggestions[0].evidenceIds = ['missing']
        else raw.suggestions[0].action = { tool: 'memory_update' }
        await watch.tick()
        assert.equal(watch.list().length, 0, invalid)
        assert.equal(frames.at(-1).proposalPopup, false)
        assert.match(service.status.proposalError, /生成/)
      }
      raw = structuredClone(batch)
      await watch.tick()
      assert.deepEqual(watch.list().map(p => p.advice), ['Check the parcel count.', 'Collect ready parcels.'])
      assert.equal(frames.at(-1).proposalPopup, true)
      assert.deepEqual(requests.at(-1).topics[0].evidence.map(e => e.field), ['ready', 'count'])
      assert.equal(JSON.stringify(requests).includes('privateInstruction'), false)
      const published = normalize(), ids = watch.list().map(p => p.id)
      assert.ok(watch.list().every(p => p.action?.tool === 'memory_update' && p.actionId === 'save-collection' && p.nextStep === 'Save a collection note' && p.confirmation === '记住 deliveries：Collect ready parcels'))
      await service.proposalCommand({ type: 'proposal_presented', ids })
      await assert.rejects(service.proposalCommand({ type: 'proposal_respond', id: ids[0], decision: 'accept', confirmation: '' }), /confirmation/)
      await watch.tick()
      assert.deepEqual(watch.list().map(p => p.id), ids)
      assert.equal(frames.at(-1).proposalPopup, false)
      if (!external) defaultCheckpoint = storage.load()
      await resident.setEnabled('odk.personal-bot.watch', false)
      const released = watch
      if (external) storage.save(defaultCheckpoint)
      await resident.setEnabled('odk.personal-bot.watch', true); await watch.inflight
      const savedIds = (external ? defaultCheckpoint : storage.load()).proposals.map(p => p.id)
      assert.deepEqual(initialized.map(p => p.id), savedIds, 'checkpoint identities must survive before another generation runs')
      assert.ok(initialized.every(p => p.presented), 'checkpoint acknowledgement must survive before polling')
      assert.deepEqual(watch.list().map(p => p.id), savedIds)
      assert.ok(watch.list().every(p => p.presented))
      assert.equal(frames.at(-1).proposalPopup, false)
      assert.equal(released.push(['parcels']), false)
      reports.push({ published, recovered: normalize(), acknowledged: watch.list().map(p => p.presented) })
      const deliveries = []
      for (const policy of [
        { name: 'push limit', maxPush: 1, automatic: true },
        { name: 'silent', rule: { delivery: 'silent' }, automatic: false },
        { name: 'quiet', quiet: true, automatic: false },
        { name: 'urgent in quiet hours', quiet: true, rule: { urgent: true }, automatic: true },
      ]) {
        await resident.setEnabled('odk.personal-bot.watch', false)
        provider.options.config = { ...structuredClone(config), maxPush: policy.maxPush ?? config.maxPush,
          rules: [{ ...structuredClone(config.rules[0]), ...policy.rule }],
          ...(policy.quiet ? { quietHours: { start: '09:00', end: '11:00', timeZone: 'UTC' } } : {}) }
        storage.save({ version: 1, proposals: [] })
        await resident.setEnabled('odk.personal-bot.watch', true); await watch.inflight
        const advice = policy.advice ?? ['Check the parcel count.', 'Collect ready parcels.']
        assert.deepEqual(watch.list().map(p => p.advice), advice, policy.name)
        assert.equal(frames.at(-1).proposalPopup, policy.automatic, policy.name + ' automatic delivery')
        await watch.tick()
        assert.equal(frames.at(-1).proposalPopup, false, policy.name + ' repeated polling')
        await service.proposalCommand({ type: 'proposal_list' })
        assert.equal(frames.at(-1).proposalPopup, true, policy.name + ' explicit access')
        await service.proposalCommand({ type: 'proposal_presented', ids: watch.list().map(p => p.id) })
        await watch.tick()
        assert.equal(frames.at(-1).proposalPopup, false, policy.name + ' acknowledgement')
        assert.ok(watch.list().every(p => p.action?.tool === 'memory_update' && p.actionId === 'save-collection' && p.confirmation === '记住 deliveries：Collect ready parcels'))
        deliveries.push({ name: policy.name, advice, automatic: policy.automatic, acknowledged: true })
      }
      reports.at(-1).deliveries = deliveries
    } finally { await resident.stop() }
  }
  assert.deepEqual(reports[1], reports[0])
})

test('independent selected Watch preserves owner advice, confirmation, and restart', { timeout: process.platform === 'win32' ? 900000 : 15000 }, async t => {
  // This independent fixture implements the single owner rule below, not the full Watch policy surface.
  const selected = await selection(t, 'watch', `const { randomUUID } = require('node:crypto')
exports.create = context => {
  const options = require('./watch-inputs.cjs').options
  const service = context.get('odk:personal-bot/service/v1')
  const runtime = context.get('odk:personal-bot/runtime/v1')
  const config = structuredClone(options.config)
  const rule = config.rules[0]
  const condition = rule.conditions[0]
  config.routineDays ??= {}
  const clock = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: config.quietHours?.timeZone ?? 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(options.now()).map(part => [part.type, part.value]))
    return { time: parts.hour + ':' + parts.minute, date: parts.year + '-' + parts.month + '-' + parts.day }
  }
  const controller = new AbortController()
  const proposals = structuredClone(options.loadState?.().proposals ?? [])
  for (const p of proposals) {
    if (p.status === 'executing') { p.status = 'unknown'; p.result = '服务中断，执行结果未确认；请通过原工具核实，不要重复执行。' }
    if (p.status === 'pending' && (p.ruleVersion !== JSON.stringify(rule) || JSON.stringify(p.action) !== JSON.stringify(rule.action) || !p.judgment)) p.status = 'expired'
    if (p.status === 'pending' && !p.presented && rule.delivery === 'immediate') p.offered = false
  }
  const watch = { proposals, closed: false, responding: false,
    persist() { options.saveState?.({ version: 1, proposals: structuredClone(this.proposals) }) },
    async current() {
      const reading = await options.read(condition.readingId, controller.signal)
      const measuredAt = reading?.value?.measured_at
      if (reading?.state !== 'live' || reading.id !== condition.readingId ||
          !Number.isFinite(Date.parse(measuredAt)) || options.now() < Date.parse(measuredAt) ||
          options.now() - Date.parse(measuredAt) > config.maxAgeMs) return null
      return [{ readingId: reading.id, field: condition.field, value: reading.value[condition.field],
        state: reading.state, measuredAt, ruleId: rule.id }]
    },
    list() {
      for (const p of this.proposals) if (p.status === 'pending' && p.evidence.some(e =>
        e.state !== 'live' || !Number.isFinite(Date.parse(e.measuredAt)) || options.now() < Date.parse(e.measuredAt)
        || options.now() - Date.parse(e.measuredAt) > config.maxAgeMs)) p.status = 'expired'
      return structuredClone(this.proposals)
    },
    emit(interaction = false) {
      if (this.closed) return
      this.list()
      const local = clock()
      const quiet = config.quietHours
      const inQuietHours = quiet && quiet.start !== quiet.end && (quiet.start < quiet.end
        ? local.time >= quiet.start && local.time < quiet.end : local.time >= quiet.start || local.time < quiet.end)
      const eligible = this.proposals.filter(p => p.status === 'pending' && !this.busy && !this.storageFailure && !config.suppressed.includes(rule.id)
        && (rule.delivery !== 'routine' || (local.time >= rule.at && config.routineDays[rule.id] !== local.date))
        && (interaction ? this.revealAll || !p.presented : !p.offered && (config.snoozed[rule.id] ?? 0) <= options.now()
          && (!inQuietHours || rule.urgent) && rule.delivery !== 'silent'
          && (rule.delivery !== 'routine' || p.routineDay !== local.date)))
      const popup = eligible.length > 0
      const proposals = this.list()
      for (const p of eligible) { p.offered = true; if (rule.delivery === 'routine') p.routineDay = local.date }
      try { this.persist() } catch {
        this.storageFailure = true
        service.propose({ proposals, popup: false, interaction, hiddenCount: 0,
          error: 'Suggestions unavailable: private proposal state could not be saved. No proposal action will run.' })
        return
      }
      if (popup) this.revealAll = false
      service.propose({ proposals, popup, interaction, hiddenCount: 0 })
    },
    async tick() {
      if (this.closed) return
      if (config.suppressed.includes(rule.id) || (config.snoozed[rule.id] ?? 0) > options.now()) { this.emit(); return }
      const evidence = await this.current()
      if (this.closed) return
      if (!evidence || this.proposals.length) { this.emit(); return }
      const judged = await options.judge({ candidates: [{ id: rule.id, criteria: rule.conditions, evidence }], signal: controller.signal })
      const answer = judged.answers[rule.id]
      if (this.closed || answer.probability < answer.threshold) { this.emit(); return }
      let advice
      try { advice = await runtime.agent.phraseProposal({ advice: rule.advice, evidence, signal: controller.signal }) }
      catch { advice = rule.advice }
      if (this.closed) return
      this.proposals.push({ id: randomUUID(), ruleId: rule.id, ruleVersion: JSON.stringify(rule),
        subject: rule.id, status: 'pending', evidence, advice, action: structuredClone(rule.action),
        confirmation: '记住 ' + rule.action.params.category + '：' + rule.action.params.value,
        offered: false, presented: false, createdAt: new Date(options.now()).toISOString(), result: '',
        judgment: { model: judged.model, probability: answer.probability, threshold: answer.threshold,
          trigger: 'heartbeat', judgedAt: new Date(options.now()).toISOString() } })
      this.emit()
    },
    start() {
      const poll = () => {
        this.inflight = this.tick().catch(() => {})
        void this.inflight.then(() => { if (!this.closed) this.timer = setTimeout(poll, config.pollMs) })
      }
      poll()
    },
    async close() { this.closed = true; controller.abort(); clearTimeout(this.timer); await this.inflight },
    push(ids) { return !this.closed && ids.includes(condition.readingId) },
    interact(revealAll = false) { this.revealAll ||= revealAll; this.emit(true) },
    setBusy(value) { this.busy = value; if (!value && !this.closed) this.emit(true) },
    async presented(ids) {
      const shown = this.proposals.filter(p => ids.includes(p.id) && p.status === 'pending' && p.offered && !p.presented)
      for (const p of shown) p.presented = true
      try { this.persist() } catch { this.emit(); return }
      if (shown.length && rule.delivery === 'routine') {
        const next = { ...structuredClone(config), routineDays: { ...config.routineDays, [rule.id]: clock().date } }
        await options.save(next)
        config.routineDays = next.routineDays
      }
      this.emit()
    },
    async respond(id, decision, confirmation) {
      if (this.closed || this.storageFailure || this.responding) throw Error('Proposal response busy or unavailable')
      const p = this.proposals.find(p => p.id === id)
      if (!p || p.status !== 'pending') throw Error('Proposal no longer pending')
      if (!p.presented) throw Error('Proposal must be presented before confirmation')
      if (decision !== 'accept' || confirmation !== p.confirmation) throw Error('Exact confirmation required')
      this.responding = true
      try {
        const evidence = await this.current()
        if (!evidence || !(evidence[0].value < condition.value)) {
          p.status = 'expired'; throw Error('Proposal expired; read fresh data before another action')
        }
        p.evidence = evidence
        p.status = 'executing'
        this.persist()
        this.emit()
        if (this.storageFailure) throw Error('Private proposal state unavailable; action was not executed')
        try {
          p.result = await runtime.agent.executeProposal(rule.action.tool, structuredClone(rule.action.params), confirmation)
          p.status = 'completed'; p.completedAt = new Date(options.now()).toISOString()
        } catch { p.status = 'unknown'; p.result = '执行结果未确认；请通过原工具核实，不要重复执行。' }
        this.persist()
        const next = { ...structuredClone(config), snoozed: { ...config.snoozed, [rule.id]: options.now() + config.cooldownMs } }
        try { await options.save?.(next); config.snoozed = next.snoozed } catch { p.result += String.fromCharCode(10) + '未能保存限频配置，请检查 owner 配置。' }
      } finally { this.responding = false; this.emit() }
    },
  }
  return watch
}`)
  const providerFile = join(selected.dir, 'watch-inputs.cjs')
  await writeFile(providerFile, 'exports.options = undefined\n')
  const provider = createRequire(import.meta.url)(providerFile)
  const now = Date.parse('2026-10-02T10:00:00.000Z')
  const rule = { id: 'dry', urgent: true, delivery: 'immediate', advice: 'Check the soil.',
    conditions: [{ readingId: 'plant', field: 'soil', op: 'lt', value: 20 }],
    action: { tool: 'memory_update', params: { category: 'watering', value: 'Check the soil.' } } }
  const reports = []
  let defaultCheckpoint
  for (const external of [false, true]) {
    let live = false, executions = 0, watch, initialized, releasePending = () => {}
    const frames = []
    const service = new PersonalBotService({ record: async () => assert.fail('no capture'),
      transcribe: async () => assert.fail('no transcription'), prompt: async () => assert.fail('no voice request') })
    service.subscribe(frame => frames.push(structuredClone(frame)))
    const runtime = { agent: { phraseProposal: async ({ advice }) => advice,
      async executeProposal(tool, params, confirmation) {
        assert.equal(tool, rule.action.tool)
        assert.deepEqual(params, rule.action.params)
        assert.equal(confirmation, '记住 watering：Check the soil.')
        executions++
        return 'Memory updated.'
      }, abort() {}, close() {} } }
    provider.options = { config: { version: 1, pollMs: 60000, maxAgeMs: 1800000, cooldownMs: 3600000,
      rules: [rule], suppressed: [], snoozed: {} }, now: () => now, judge: fixtureJudge,
      read: async id => ({ id, state: live ? 'live' : 'unavailable', value: { soil: 2, measured_at: new Date(now).toISOString() } }) }
    const resident = createPersonalBotComposition({
      replacementPlugins: external ? loadPersonalBotReplacements(selected.config, { trusted: true }) : [],
      createService: () => service, openChannel: async () => ({ close() {} }), initialize: async () => runtime,
      createHome: () => ({ start() {}, close() {} }),
      createWatch() {
        assert.equal(external, false, 'selected Watch must not construct the default Watch')
        return new ProactiveWatch({ ...provider.options, phrase: runtime.agent.phraseProposal,
          execute: runtime.agent.executeProposal, publish: frame => service.propose(frame), save: provider.options.save ?? (async () => {}) })
      },
      onWatch(value, current, context) {
        watch = value
        initialized = value.list()
        current.attachWatch(value)
        context.onCleanup(() => current.attachWatch(undefined))
      },
    })
    try {
      await resident.start()
      await watch.inflight
      assert.equal((service.status.proposals ?? []).length, 0)
      live = true
      await watch.tick()
      assert.equal((service.status.proposals ?? []).length, 1, 'the selected Watch must publish current owner advice')
      const proposal = watch.list()[0]
      assert.equal(proposal.advice, rule.advice)
      assert.deepEqual(proposal.action, rule.action)
      assert.deepEqual(proposal.evidence, [{ readingId: 'plant', field: 'soil', value: 2, state: 'live',
        measuredAt: new Date(now).toISOString(), ruleId: rule.id }])
      assert.equal(proposal.status, 'pending')
      assert.equal(frames.some(frame => frame.proposalPopup), true)
      const accept = confirmation => service.proposalCommand({ type: 'proposal_respond', id: proposal.id, decision: 'accept', confirmation })
      await assert.rejects(accept(proposal.confirmation), /presented/)
      await service.proposalCommand({ type: 'proposal_presented', ids: [proposal.id] })
      await assert.rejects(accept('yes'), /confirmation/)
      assert.equal(executions, 0)
      await accept(proposal.confirmation)
      assert.equal(watch.list()[0].status, 'completed')
      assert.equal(executions, 1)
      await assert.rejects(accept(proposal.confirmation), /no longer pending/)
      assert.equal(executions, 1)
      const owned = ['service', 'channel', 'runtime', 'home'].map(name => resident.port(BOT_PORTS[name]))
      const released = watch
      await resident.setEnabled('odk.personal-bot.watch', false)
      await assert.rejects(service.proposalCommand({ type: 'proposal_list' }), /unavailable/)
      assert.equal(released.push(['plant']), false)
      const count = frames.length
      released.emit(true)
      assert.equal(frames.length, count)
      await resident.setEnabled('odk.personal-bot.watch', true)
      await watch.inflight
      assert.notEqual(watch, released)
      for (const [index, name] of ['service', 'channel', 'runtime', 'home'].entries()) {
        assert.equal(resident.port(BOT_PORTS[name]), owned[index])
      }
      assert.equal(service.status.proposals[0].status, 'pending')
      assert.equal(service.status.proposals[0].advice, rule.advice)
      const current = structuredClone(service.status)
      released.emit(true)
      assert.deepEqual(service.status, current)
      reports.push({ advice: proposal.advice, action: proposal.action, evidence: proposal.evidence,
        status: service.status.proposals[0].status, executions })
      const read = provider.options.read, judge = provider.options.judge, phrase = runtime.agent.phraseProposal
      for (const stage of ['reading', 'judgment', 'phrasing']) {
        await resident.setEnabled('odk.personal-bot.watch', false)
        let enter, observedSignal, cancelled = false
        const ready = new Promise(resolve => { enter = resolve })
        const hold = async (value, signal) => {
          observedSignal = signal
          let abort
          try {
            return await new Promise((resolve, reject) => {
              releasePending = () => resolve(value)
              abort = () => { cancelled = true; reject(Error('controlled cancellation')) }
              signal?.addEventListener('abort', abort, { once: true })
              enter()
              if (signal?.aborted) abort()
            })
          } finally { signal?.removeEventListener('abort', abort) }
        }
        provider.options.read = stage === 'reading' ? async (id, signal) => hold(await read(id, signal), signal) : read
        provider.options.judge = stage === 'judgment' ? async input => hold(await judge(input), input.signal) : judge
        runtime.agent.phraseProposal = stage === 'phrasing' ? ({ advice, signal }) => hold(advice, signal) : phrase
        const before = frames.length
        const previousProposals = structuredClone(service.status.proposals)
        await resident.setEnabled('odk.personal-bot.watch', true)
        await ready
        assert.ok(observedSignal instanceof AbortSignal, `${stage} must receive the Watch cancellation signal`)
        const pendingWatch = watch
        let settled = false
        const pending = pendingWatch.inflight.then(() => { settled = true })
        await resident.setEnabled('odk.personal-bot.watch', false)
        await pending
        assert.equal(cancelled, true, stage)
        assert.equal(settled, true, stage)
        assert.deepEqual(frames.slice(before).map(frame => frame.proposalCapabilities), [
          { read: true, respond: true, acknowledge: true }, { read: false, respond: false, acknowledge: false },
        ], `${stage} publishes only the declared Watch capability transitions`)
        for (const frame of frames.slice(before)) assert.deepEqual(frame.proposals, previousProposals, `${stage} must not publish suggestions after cancellation`)
        assert.equal(pendingWatch.list().length, 0)
        provider.options.read = read
        provider.options.judge = judge
        runtime.agent.phraseProposal = phrase
        await resident.setEnabled('odk.personal-bot.watch', true)
        await watch.inflight
        assert.notEqual(watch, pendingWatch)
        assert.equal(service.status.proposals[0].advice, rule.advice)
        for (const [index, name] of ['service', 'channel', 'runtime', 'home'].entries()) {
          assert.equal(resident.port(BOT_PORTS[name]), owned[index])
        }
        const current = structuredClone(service.status), count = frames.length
        releasePending()
        await Promise.resolve()
        assert.equal(frames.length, count)
        assert.deepEqual(service.status, current)
      }
      const deliveries = []
      const baseConfig = structuredClone(provider.options.config)
      for (const policy of [
        { name: 'silent', rule: { delivery: 'silent', urgent: false }, popup: false, reveal: true },
        { name: 'quiet', rule: { urgent: false }, quietHours: { start: '09:00', end: '11:00', timeZone: 'UTC' }, popup: false, reveal: true },
        { name: 'urgent in quiet hours', rule: { urgent: true }, quietHours: { start: '09:00', end: '11:00', timeZone: 'UTC' }, popup: true, reveal: true },
        { name: 'timezone quiet hours', rule: { urgent: false }, quietHours: { start: '05:00', end: '07:00', timeZone: 'America/New_York' }, popup: false, reveal: true },
        { name: 'routine before due time', rule: { delivery: 'routine', at: '11:00' }, popup: false, reveal: false },
        { name: 'routine due', rule: { delivery: 'routine', at: '10:00' }, popup: true, reveal: true, day: '2026-10-02' },
        { name: 'routine acknowledged', rule: { delivery: 'routine', at: '10:00' }, routineDays: { dry: '2026-10-02' }, popup: false, reveal: false },
        { name: 'snoozed', snoozed: { dry: now + 60000 }, count: 0, popup: false, reveal: false },
        { name: 'suppressed', suppressed: ['dry'], count: 0, popup: false, reveal: false },
        { name: 'busy', busy: true, popup: false, reveal: true },
      ]) {
        await resident.setEnabled('odk.personal-bot.watch', false)
        live = false
        provider.options.config = { ...structuredClone(baseConfig), rules: [{ ...structuredClone(rule), ...policy.rule }],
          ...(policy.quietHours ? { quietHours: policy.quietHours } : {}),
          routineDays: policy.routineDays ?? {}, snoozed: policy.snoozed ?? {}, suppressed: policy.suppressed ?? [] }
        const saved = []
        provider.options.save = async config => { saved.push(structuredClone(config)) }
        await resident.setEnabled('odk.personal-bot.watch', true)
        await watch.inflight
        live = true
        if (policy.busy) watch.setBusy(true)
        await watch.tick()
        assert.equal(watch.list().length, policy.count ?? 1, policy.name)
        assert.equal(frames.at(-1).proposalPopup, policy.popup, policy.name)
        const before = executions
        await watch.tick()
        assert.equal(frames.at(-1).proposalPopup, false, policy.name + ' must not repeat automatically')
        if (policy.busy) {
          watch.setBusy(false)
          assert.equal(frames.at(-1).proposalPopup, true, 'leaving busy state resumes pending presentation')
        }
        await service.proposalCommand({ type: 'proposal_list' })
        assert.equal(frames.at(-1).proposalPopup, policy.reveal, policy.name + ' explicit list')
        assert.equal(saved.length, 0, policy.name + ' must not save an unacknowledged owner day')
        await service.proposalCommand({ type: 'proposal_presented', ids: watch.list().map(p => p.id) })
        assert.deepEqual(saved.map(config => config.routineDays.dry), policy.day ? [policy.day] : [], policy.name)
        if (policy.day) {
          await service.proposalCommand({ type: 'proposal_list' })
          assert.equal(frames.at(-1).proposalPopup, false, 'routine is acknowledged for the owner day')
        }
        assert.equal(executions, before, policy.name + ' must not execute an action')
        deliveries.push({ name: policy.name, count: watch.list().length, automatic: policy.popup, requested: policy.reveal,
          days: saved.map(config => config.routineDays.dry) })
      }
      reports.at(-1).deliveries = deliveries
      t.diagnostic((external ? 'selected' : 'default') + ' delivery comparison passed')
      await resident.setEnabled('odk.personal-bot.watch', false)
      let elapsed = 0
      provider.options.config = structuredClone(baseConfig)
      provider.options.now = () => now + elapsed
      await resident.setEnabled('odk.personal-bot.watch', true)
      await watch.inflight
      const aging = watch.list()[0]
      await service.proposalCommand({ type: 'proposal_presented', ids: [aging.id] })
      const beforeExpiry = executions
      elapsed = baseConfig.maxAgeMs
      assert.equal(watch.list()[0].status, 'pending', 'the exact evidence age limit remains usable')
      elapsed++
      await service.proposalCommand({ type: 'proposal_list' })
      assert.equal(service.status.proposals[0].id, aging.id)
      assert.equal(service.status.proposals[0].status, 'expired', 'explicit access must expire old evidence')
      assert.equal(frames.at(-1).proposalPopup, false, 'expired evidence cannot request presentation')
      await assert.rejects(service.proposalCommand({ type: 'proposal_respond', id: aging.id,
        decision: 'accept', confirmation: aging.confirmation }), /no longer pending/)
      assert.equal(executions, beforeExpiry, 'expired evidence must not execute an action')
      reports.at(-1).evidenceExpiry = { boundary: 'pending', after: service.status.proposals[0].status }
      t.diagnostic((external ? 'selected' : 'default') + ' evidence age comparison passed')
      provider.options.now = () => now
      await resident.setEnabled('odk.personal-bot.watch', false)
      const privateRoot = await realpath(selected.dir)
      protectProactivePath(privateRoot)
      const file = join(privateRoot, external ? 'selected-checkpoint' : 'default-checkpoint', 'state.json')
      const storage = proposalStateStore(file)
      let failCheckpoint = false, checkpointExecutions = 0
      provider.options.config = structuredClone(baseConfig)
      provider.options.save = async () => {}
      provider.options.loadState = storage.load
      provider.options.saveState = state => {
        if (failCheckpoint) throw Error('controlled checkpoint unavailable')
        storage.save(state)
      }
      if (external) storage.save(defaultCheckpoint)
      runtime.agent.executeProposal = async () => {
        assert.equal(storage.load().proposals[0].status, 'executing', 'reserve on disk before executing')
        checkpointExecutions++
        return 'Memory updated.'
      }
      const restart = async () => {
        await resident.setEnabled('odk.personal-bot.watch', false)
        await resident.setEnabled('odk.personal-bot.watch', true)
        await watch.inflight
      }
      await restart()
      const savedProposal = watch.list()[0]
      if (external) {
        assert.equal(savedProposal.id, defaultCheckpoint.proposals[0].id, 'selected Watch must read the default saved identity')
        assert.equal(savedProposal.presented, true, 'import must retain acknowledgement before another service command')
        assert.equal(storage.load().proposals[0].presented, true)
        assert.equal(frames.at(-1).proposalPopup, false, 'an imported presented proposal must not pop up again')
      }
      assert.equal(storage.load().proposals.length, 1, 'the selected Watch must checkpoint its published proposal')
      assert.equal(storage.load().proposals[0].id, savedProposal.id, 'creation is durable')
      await service.proposalCommand({ type: 'proposal_presented', ids: [savedProposal.id] })
      assert.equal(storage.load().proposals[0].presented, true)
      if (!external) defaultCheckpoint = storage.load()
      await restart()
      assert.equal(watch.list()[0].id, savedProposal.id, 'restart must not create another proposal')
      assert.equal(watch.list()[0].presented, true)
      assert.equal(frames.at(-1).proposalPopup, false)
      const confirmSaved = () => service.proposalCommand({ type: 'proposal_respond', id: savedProposal.id, decision: 'accept', confirmation: savedProposal.confirmation })
      await confirmSaved()
      assert.equal(checkpointExecutions, 1)
      assert.equal(storage.load().proposals[0].status, 'completed')
      await restart()
      assert.equal(watch.list()[0].status, 'completed')
      await assert.rejects(confirmSaved(), /no longer pending/)
      assert.equal(checkpointExecutions, 1)
      const interrupted = storage.load()
      interrupted.proposals[0].status = 'executing'
      storage.save(interrupted)
      await restart()
      assert.equal(watch.list()[0].id, savedProposal.id)
      assert.equal(watch.list()[0].status, 'unknown')
      assert.equal(storage.load().proposals[0].status, 'unknown')
      await assert.rejects(confirmSaved(), /no longer pending/)
      assert.equal(checkpointExecutions, 1)
      await resident.setEnabled('odk.personal-bot.watch', false)
      storage.save({ version: 1, proposals: [] })
      await restart()
      const blocked = watch.list()[0]
      await service.proposalCommand({ type: 'proposal_presented', ids: [blocked.id] })
      failCheckpoint = true
      await assert.rejects(service.proposalCommand({ type: 'proposal_respond', id: blocked.id,
        decision: 'accept', confirmation: blocked.confirmation }), /checkpoint unavailable/)
      assert.equal(checkpointExecutions, 1, 'failed reservation must not run an action')
      assert.match(service.status.proposalError, /private proposal state could not be saved/)
      assert.equal(frames.at(-1).proposalPopup, false)
      assert.doesNotMatch(service.status.proposalError, /controlled checkpoint/)
      await assert.rejects(service.proposalCommand({ type: 'proposal_respond', id: blocked.id,
        decision: 'accept', confirmation: blocked.confirmation }), /unavailable/)
      failCheckpoint = false
      await restart()
      assert.equal(watch.list()[0].id, blocked.id)
      assert.equal(watch.list()[0].status, 'pending', 'unexecuted failed reservation can recover from the saved proposal')
      t.diagnostic((external ? 'selected' : 'default') + ' reservation and recovery passed')
      const pendingCheckpoint = storage.load()
      const expiry = []
      for (const invalid of ['rule changed', 'owner action removed', 'saved action changed', 'judgment missing']) {
        await resident.setEnabled('odk.personal-bot.watch', false)
        provider.options.config = structuredClone(baseConfig)
        const state = structuredClone(pendingCheckpoint)
        if (invalid === 'rule changed') provider.options.config.rules[0].advice = 'Updated owner advice.'
        if (invalid === 'owner action removed') {
          delete provider.options.config.rules[0].action
          state.proposals[0].ruleVersion = JSON.stringify(provider.options.config.rules[0])
        }
        if (invalid === 'saved action changed') state.proposals[0].action.params.value = 'Unapproved saved action.'
        if (invalid === 'judgment missing') delete state.proposals[0].judgment
        storage.save(state)
        live = false
        await restart()
        assert.equal(initialized[0].id, blocked.id)
        assert.equal(initialized[0].status, 'expired', invalid + ' must expire during initialization, before source polling')
        assert.equal(storage.load().proposals[0].status, 'expired')
        await assert.rejects(service.proposalCommand({ type: 'proposal_respond', id: blocked.id,
          decision: 'accept', confirmation: blocked.confirmation }), /no longer pending/)
        assert.equal(checkpointExecutions, 1)
        expiry.push({ reason: invalid, state: initialized[0].status })
      }
      t.diagnostic((external ? 'selected' : 'default') + ' initialization expiry passed')
      const lostAcknowledgements = []
      for (const delivery of ['immediate', 'routine']) {
        await resident.setEnabled('odk.personal-bot.watch', false)
        provider.options.config = { ...structuredClone(baseConfig), rules: [{ ...structuredClone(rule), delivery,
          ...(delivery === 'routine' ? { at: '10:00' } : {}) }] }
        const ownerWrites = []
        provider.options.save = async config => { ownerWrites.push(structuredClone(config)) }
        storage.save({ version: 1, proposals: [] })
        live = true
        await restart()
        const offered = watch.list()[0]
        assert.equal(frames.at(-1).proposalPopup, true)
        assert.equal(storage.load().proposals[0].offered, true)
        assert.equal(storage.load().proposals[0].presented, false)
        await restart()
        assert.equal(watch.list()[0].id, offered.id)
        assert.equal(frames.at(-1).proposalPopup, delivery === 'immediate', delivery + ' lost acknowledgement')
        await service.proposalCommand({ type: 'proposal_list' })
        assert.equal(frames.at(-1).proposalPopup, true, delivery + ' explicit recovery')
        await service.proposalCommand({ type: 'proposal_presented', ids: [offered.id] })
        assert.equal(storage.load().proposals[0].presented, true)
        assert.deepEqual(ownerWrites.map(config => config.routineDays.dry), delivery === 'routine' ? ['2026-10-02'] : [])
        if (delivery === 'routine') provider.options.config = ownerWrites.at(-1)
        await restart()
        assert.equal(watch.list()[0].id, offered.id)
        assert.equal(watch.list()[0].presented, true)
        assert.equal(frames.at(-1).proposalPopup, false)
        await service.proposalCommand({ type: 'proposal_list' })
        assert.equal(frames.at(-1).proposalPopup, delivery === 'immediate', delivery + ' acknowledged explicit access')
        assert.equal(checkpointExecutions, 1)
        lostAcknowledgements.push({ delivery, retried: delivery === 'immediate', ownerDays: ownerWrites.map(config => config.routineDays.dry) })
      }
      reports.at(-1).expiry = expiry
      reports.at(-1).lostAcknowledgements = lostAcknowledgements
      t.diagnostic((external ? 'selected' : 'default') + ' acknowledgement recovery passed')
      await resident.setEnabled('odk.personal-bot.watch', false)
      provider.options.config = { ...structuredClone(baseConfig),
        rules: [{ ...structuredClone(rule), delivery: 'routine', at: '10:00' }] }
      let ownerUnavailable = true
      const recoveredOwnerWrites = []
      provider.options.save = async config => {
        if (ownerUnavailable) throw Error('controlled owner unavailable')
        recoveredOwnerWrites.push(structuredClone(config))
      }
      storage.save({ version: 1, proposals: [] })
      await restart()
      const ownerFailure = watch.list()[0]
      await assert.rejects(service.proposalCommand({ type: 'proposal_presented', ids: [ownerFailure.id] }), /owner unavailable/)
      assert.equal(storage.load().proposals[0].presented, true, 'owner failure must not lose the durable acknowledgement')
      assert.equal(recoveredOwnerWrites.length, 0, 'failed owner save cannot advance the owner day')
      assert.equal(checkpointExecutions, 1)
      await restart()
      assert.equal(watch.list()[0].id, ownerFailure.id)
      assert.equal(watch.list()[0].presented, true)
      assert.equal(frames.at(-1).proposalPopup, false, 'restart cannot repeat an acknowledged routine popup')
      watch.setBusy(true)
      await service.proposalCommand({ type: 'proposal_list' })
      assert.equal(frames.at(-1).proposalPopup, false)
      watch.setBusy(false)
      assert.equal(frames.at(-1).proposalPopup, true, 'explicit recovery survives the busy state')
      ownerUnavailable = false
      const confirmRecovered = () => service.proposalCommand({ type: 'proposal_respond', id: ownerFailure.id,
        decision: 'accept', confirmation: ownerFailure.confirmation })
      await confirmRecovered()
      assert.equal(storage.load().proposals[0].status, 'completed')
      assert.equal(checkpointExecutions, 2)
      assert.equal(recoveredOwnerWrites.length, 1, 'confirmed action retains its cooldown save')
      assert.equal(recoveredOwnerWrites[0].snoozed.dry, now + baseConfig.cooldownMs)
      await restart()
      await assert.rejects(confirmRecovered(), /no longer pending/)
      assert.equal(checkpointExecutions, 2)
      reports.at(-1).ownerFailure = { acknowledgement: true, recoveryPopup: true, status: watch.list()[0].status }
      t.diagnostic((external ? 'selected' : 'default') + ' owner configuration recovery passed')
      await resident.setEnabled('odk.personal-bot.watch', false)
      await writeFile(file, '{corrupt private fixture')
      await resident.setEnabled('odk.personal-bot.watch', true)
      assert.equal(resident.port(BOT_PORTS.watch), null, 'corrupt state must fail Watch initialization')
      assert.equal(resident.catalog().find(p => p.manifest.id === 'odk.personal-bot.watch').state, 'failed')
      assert.equal(await readFile(file, 'utf8'), '{corrupt private fixture')
      await assert.rejects(service.proposalCommand({ type: 'proposal_list' }), /unavailable/)
      for (const [index, name] of ['service', 'channel', 'runtime', 'home'].entries()) {
        assert.equal(resident.port(BOT_PORTS[name]), owned[index])
      }
      assert.equal(checkpointExecutions, 2)
      reports.at(-1).checkpoint = { executions: checkpointExecutions, corruptState: 'failed', interrupted: 'unknown' }
    } finally { releasePending(); await resident.stop() }
  }
  assert.deepEqual(reports[1], reports[0])
})

test('inspection is lazy and native trust is required', async t => {
  const selected = await selection(t, 'home', "throw Error('entry executed')")
  assert.throws(() => loadPersonalBotReplacements(selected.config), /trust/)
  const resident = composition(loadPersonalBotReplacements(selected.config, { trusted: true }))
  assert.equal(resident.catalog().length, 7)
})

test('incompatible replacement fails before any factory runs', () => {
  let calls = 0
  assert.throws(() => composition([{ manifest: { ...personalBotManifest('home'), provides: [{ interface: 'odk:personal-bot/home/v2' }] }, create() { calls++ } }]), /contract/)
  assert.equal(calls, 0)
})

test('actual resident inspection validates without executing entries or requiring operational paths', async t => {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const selected = await selection(t, 'home', "throw Error('private entry must not execute')")
  const entry = new URL('../src/main.mjs', import.meta.url)
  const { fileURLToPath } = await import('node:url')
  const result = await promisify(execFile)(process.execPath, [fileURLToPath(entry), '--plugin-selection', selected.config, '--trust-plugins', '--plugins', 'validate'], {
    timeout: 10000, env: { PATH: process.env.PATH, ODK_CONFIG_DIR: selected.dir },
  })
  const report = JSON.parse(result.stdout)
  assert.equal(report.scope, 'declarations')
  assert.equal(report.plugins.find(item => item.manifest.id === 'odk.personal-bot.home').manifest.version, '2.0.0')
  assert.equal(result.stderr, '')
})

test('actual resident startup uses external runtime and home then closes them on termination', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const { spawn } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const selected = await selection(t, 'runtime', "exports.create = () => ({ agent: { abort() { console.log('agent.aborted') }, close() { console.log('agent.closed') } } })")
  const home = join(selected.dir, 'home.cjs')
  await writeFile(home, "exports.create = () => ({ start() { console.log('home.started') }, close() { console.log('home.closed') } })")
  await writeFile(selected.config, JSON.stringify({ schemaVersion: 1, replacements: [
    { manifest: { ...personalBotManifest('runtime'), version: '2.0.0' }, entry: selected.entry },
    { manifest: { ...personalBotManifest('home'), version: '2.0.0' }, entry: home },
  ] }))
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/main.mjs', import.meta.url)), '--plugin-selection', selected.config, '--trust-plugins'], {
    env: { PATH: process.env.PATH, HOME: selected.dir, XDG_RUNTIME_DIR: selected.dir, XDG_STATE_HOME: selected.dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL') })
  let output = ''
  let errors = ''
  child.stderr.on('data', chunk => { errors += chunk })
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error(`startup timed out: ${errors}`)), 10000)
    child.stdout.on('data', chunk => {
      output += chunk
      if (output.includes('home.started')) { clearTimeout(timeout); resolve() }
    })
    child.once('close', code => { clearTimeout(timeout); reject(Error(`startup exited ${code}: ${errors}`)) })
    child.once('error', error => { clearTimeout(timeout); reject(error) })
  })
  child.kill('SIGTERM')
  assert.deepEqual(await closed, { code: 0, signal: null })
  assert.equal(output.match(/home.closed/g)?.length, 1)
  assert.equal(output.match(/agent.aborted/g)?.length, 1)
  assert.equal(output.match(/agent.closed/g)?.length, 1)
  assert.equal(errors, '')
})

test('selected observer identities and cleanup refer to the owned resources', async t => {
  const selected = await selection(t, 'home', "exports.create = () => ({ start() {}, close() {} })")
  const seen = []
  let service
  let runtime
  const resident = createPersonalBotComposition({
    replacementPlugins: loadPersonalBotReplacements(selected.config, { trusted: true }),
    createService: () => ({ close() {} }), openChannel: async () => ({ close() {} }),
    initialize: async () => ({ agent: { abort() {}, close() {} } }),
    createHome() { throw Error('default home must not execute') },
    onService(value) { service = value }, onRuntime(value) { runtime = value },
    onHome(value, actualService, context) {
      seen.push(value)
      assert.equal(actualService, service)
      assert.equal(context.get(BOT_PORTS.runtime), runtime)
      context.onCleanup(() => seen.push('released'))
    },
  })
  await resident.start()
  assert.equal(seen[0], resident.port(BOT_PORTS.home))
  await resident.stop()
  assert.deepEqual(seen.slice(1), ['released'])
  assert.equal(runtime, undefined)
})

test('failed external home initialization cleans allocations and preserves the resident channel', async t => {
  const selected = await selection(t, 'home', "exports.create = ctx => { ctx.onCleanup(() => { globalThis.__botPluginReleased = true }); throw Error('private initialization error') }")
  t.after(() => { delete globalThis.__botPluginReleased })
  const resident = composition(loadPersonalBotReplacements(selected.config, { trusted: true }))
  await resident.start()
  assert.equal(globalThis.__botPluginReleased, true)
  assert.equal(resident.port(BOT_PORTS.home), null)
  assert.ok(resident.port(BOT_PORTS.channel))
  assert.ok(resident.port(BOT_PORTS.runtime))
  assert.equal(resident.catalog().find(item => item.manifest.id === 'odk.personal-bot.home').state, 'failed')
  await resident.stop()
})

for (const invalid of ['host', 'kind', 'permissions', 'requires', 'duplicate', 'schema', 'extra', 'relative', 'extension', 'inactive']) {
  test(`invalid ${invalid} selection fails before entries execute`, async t => {
    const { readFile } = await import('node:fs/promises')
    const selected = await selection(t, invalid === 'inactive' ? 'watch' : 'home', "throw Error('entry executed')")
    const config = JSON.parse(await readFile(selected.config, 'utf8'))
    const definition = config.replacements[0]
    if (invalid === 'host') definition.manifest.host = 'electron-main'
    if (invalid === 'kind') definition.manifest.kind = 'transport'
    if (invalid === 'permissions') definition.manifest.permissions = ['native.extra']
    if (invalid === 'requires') definition.manifest.requires = []
    if (invalid === 'duplicate') config.replacements.push(definition)
    if (invalid === 'schema') config.schemaVersion = 2
    if (invalid === 'extra') config.unrecognized = true
    if (invalid === 'relative') definition.entry = 'entry.cjs'
    if (invalid === 'extension') definition.entry = selected.entry + '.js'
    await writeFile(selected.config, JSON.stringify(config))
    assert.throws(() => {
      const replacements = loadPersonalBotReplacements(selected.config, { trusted: true })
      createPersonalBotComposition({ replacementPlugins: replacements,
        createService() {}, openChannel() {}, initialize() {}, createHome() {},
      })
    }, /contract|invalid|duplicate|absolute|inactive/)
  })
}
