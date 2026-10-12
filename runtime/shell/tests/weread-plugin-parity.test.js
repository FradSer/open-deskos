'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')
const { execFile } = require('node:child_process')
const { createPluginHost } = require('../src/plugin-host')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { createWeReadSource } = require('../src/weread-source')
const { createShellDeskData } = require('../src/desk-data')
const { loadDevelopmentPlugins } = require('../src/development-plugins')
const { readConfig, resolveConfigPath } = require('../src/plugin-config')
const { DATA_PORTS } = require('../src/plugins/data-sources')
const { DESK_PORTS } = require('../src/plugins/desk-runtime')
const { healthPort } = require('../src/plugins/health')
const { install } = require('./helpers/weread-selection')
const run = promisify(execFile)
const directory = path.join(__dirname, 'fixtures/weread-replacement')
const cli = path.join(__dirname, '../scripts/open-deskos-plugin-cli.js')
const timestamp = 1700000000000

async function fixture(t, replacement, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-weread-parity-'))
  let host
  t.after(async () => { try { await host?.stop() } finally { fs.rmSync(root, { recursive: true, force: true }) } })
  const env = { ...process.env, OPEN_DESKOS_CONFIG_DIR: path.join(root, 'config'),
    XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state') }
  const cacheFile = path.join(root, 'highlights.json')
  if (options.cache) fs.writeFileSync(cacheFile, JSON.stringify(options.cache))
  const configuration = { apiKey: 'controlled-key', now: () => timestamp, random: () => 0, ...options, cacheFile }
  let replacements = []
  let native
  const reports = []
  if (replacement === 'signed') {
    native = await install(root, env)
    if (options.corruptBeforeLoad) fs.appendFileSync(native.stored.entry, '\nthrow Error("Corrupt fixture entry")')
    if (options.removeBeforeLoad) await native.command(['remove', 'odk.source.weread'])
    replacements = await native.load({ report: (id, error) => reports.push({ id, error }) })
    assert.equal(replacements.length, options.corruptBeforeLoad || options.removeBeforeLoad ? 0 : 1)
    if (replacements.length && options.mutateStored !== false) native.mutate()
  } else if (replacement) {
    await run(process.execPath, [cli, 'link', directory, '--trust', '--replace', '--grant', 'source.weread', '--grant', 'ipc'], { env })
    replacements = loadDevelopmentPlugins(readConfig(resolveConfigPath(env)))
    assert.equal(replacements.length, 1)
  }
  if (replacement === 'signed' && !options.removeBeforeLoad) assert.ok(readConfig(resolveConfigPath(env)).plugins['odk.source.weread']?.native,
    'Signed acceptance must use native installation instead of a development link')
  const handlers = new Map()
  let created = 0
  host = createPluginHost({ capabilities: {
    ipc: { handle(name, handler) { assert.equal(handlers.has(name), false); handlers.set(name, handler) }, removeHandler: name => handlers.delete(name) },
    'source.weread': { options: configuration, create(settings) {
      assert.equal(replacements.length, 0, 'replacement must not call the built-in source factory')
      created++
      return createWeReadSource(settings)
    } },
    'desk.data': { create: createShellDeskData, smokeMode: true },
  } })
  createMainPlugins({ replacementPlugins: replacements })
    .filter(plugin => ['odk.source.weread', 'odk.system.desk-data'].includes(plugin.manifest.id))
    .forEach(plugin => host.register(plugin))
  await host.start()
  assert.equal(host.list().find(record => record.manifest.id === 'odk.source.weread').state, 'running')
  assert.equal(host.list().find(record => record.manifest.id === 'odk.source.weread').manifest.version, replacements.length ? '2.0.0' : '1.0.0')
  assert.equal(host.get(DATA_PORTS.weread).fixtureRevision, native && replacements.length ? '2.0.0' : undefined)
  return { root, env, cacheFile, configuration, host, handlers, native, reports, created: () => created,
    health: () => host.get(healthPort('odk.source.weread')).snapshot(),
    ipc: () => handlers.get('odk-weread-highlight')(null),
    read: () => host.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.weread' }),
  }
}

function api(calls, state) {
  return async (url, options) => {
    calls.push({ url, options })
    if (state.fail) throw Error('controlled offline')
    if (!options?.body) return { ok: true, headers: { get: () => state.coverType || 'image/jpeg' }, arrayBuffer: async () => state.cover || Buffer.from('cover') }
    const body = JSON.parse(options.body)
    assert.equal(body.skill_version, '1.0.4')
    assert.equal(options.headers.Authorization, 'Bearer controlled-key')
    return { ok: true, json: async () => body.api_name === '/user/notebooks'
      ? { books: state.books ?? [1, 2].map(id => ({ bookId: String(id), noteCount: 1, book: { title: `Book ${id}`, writer: `Author ${id}`, coverUrl: 'https://controlled/cover' } })) }
      : { updated: [{ type: 1, markText: `Text ${body.bookId}`, range: 'Chapter', createTime: Number(body.bookId) },
        { type: 1, markText: '[插图]' }, { type: 2, markText: 'Comment' }] } }
  }
}

for (const replacement of [false, true, 'signed']) {
  const name = replacement === 'signed' ? 'signed independent WeRead' : replacement ? 'independently linked WeRead' : 'default WeRead'
  test(`${name} preserves live output, selection, cache, resync, and consumer lifecycle`, async t => {
    let time = timestamp
    const calls = []
    const state = {}
    const f = await fixture(t, replacement, { fetchImpl: api(calls, state), now: () => time })
    assert.equal(f.host.get(DATA_PORTS.weread).snapshot().status, 'loading')
    assert.equal(calls.length, 0)
    assert.equal(f.health().state, 'degraded')
    assert.equal(calls.length, 0, 'health must not refresh the source')
    const first = await f.ipc()
    assert.deepEqual(first, { status: 'live', highlight: { type: 1, markText: 'Text 2', range: 'Chapter', createTime: 2,
      title: 'Book 2', author: 'Author 2', cover: `data:image/jpeg;base64,${Buffer.from('cover').toString('base64')}` }, updatedAt: timestamp })
    const reading = (await f.read()).reading
    assert.equal(reading.state, 'live')
    assert.deepEqual(reading.value, { asOf: new Date(timestamp).toISOString(), book: { title: 'Book 1', author: 'Author 1' }, highlight: { text: 'Text 1', chapterRange: 'Chapter' } })
    assert.equal(calls.length, 4, 'three API requests and one cached cover')
    assert.equal(f.health().state, 'healthy')
    assert.equal(calls.length, 4)
    const cached = JSON.parse(fs.readFileSync(f.cacheFile, 'utf8'))
    assert.equal(cached.version, 2)
    assert.equal(cached.syncedAt, timestamp)
    assert.deepEqual(cached.highlights.map(entry => entry.markText), ['Text 2', 'Text 1'])
    time += 30 * 60 * 1000 - 1
    assert.equal((await f.ipc()).highlight.title, 'Book 2')
    assert.equal(calls.length, 4)
    time++
    assert.equal((await f.ipc()).status, 'live')
    assert.equal(calls.length, 8)
    const original = f.host.get(DATA_PORTS.weread)
    await f.host.setEnabled('odk.source.weread', false)
    assert.equal(f.handlers.size, 0)
    assert.equal(f.host.get(DATA_PORTS.weread), null)
    assert.equal(f.host.get(DESK_PORTS.data).registry.list().some(entry => entry.id === 'odk.tile.weread'), false)
    await f.host.setEnabled('odk.source.weread', true)
    assert.notEqual(f.host.get(DATA_PORTS.weread), original)
    assert.equal(f.host.get(DATA_PORTS.weread).snapshot().status, 'live')
    assert.equal((await f.ipc()).status, 'live')
    assert.equal(calls.length, 9, 'cached restart only resolves its cover')
  })

  test(`${name} preserves empty, error, unconfigured, and cached unconfigured states`, async t => {
    const state = { fail: true }
    const failed = await fixture(t, replacement, { fetchImpl: api([], state) })
    assert.deepEqual(await failed.ipc(), { status: 'error', highlight: null, updatedAt: timestamp, error: 'controlled offline' })
    assert.equal(failed.health().state, 'failed')
    assert.equal((await failed.read()).reading.state, 'unavailable')
    state.fail = false
    state.books = []
    assert.equal((await failed.ipc()).status, 'empty')
    assert.equal((await failed.read()).reading.value.book, null)
    const forbidden = () => { throw Error('unconfigured source contacted network') }
    const missing = await fixture(t, replacement, { apiKey: '', fetchImpl: forbidden })
    assert.deepEqual(await missing.ipc(), { status: 'unconfigured', highlight: null, updatedAt: null })
    assert.equal((await missing.read()).reading.value, null)
    assert.equal(missing.health().state, 'degraded')
    const cached = await fixture(t, replacement, { apiKey: '', fetchImpl: forbidden,
      cache: { version: 2, syncedAt: timestamp, highlights: [{ title: 'Cached', markText: 'Saved', cover: 'https://controlled/old' }] } })
    assert.equal((await cached.ipc()).highlight.markText, 'Saved')
    assert.equal((await cached.read()).reading.state, 'live')
  })

  test(`${name} hides non-image, empty, and oversized covers and retries errors`, async t => {
    for (const state of [{ coverType: 'text/html' }, { cover: Buffer.alloc(0) }, { cover: Buffer.alloc(512 * 1024 + 1) }]) {
      const f = await fixture(t, replacement, { fetchImpl: api([], state) })
      assert.equal((await f.ipc()).highlight.cover, '')
    }
    const calls = []
    const state = { cover: Buffer.alloc(512 * 1024) }
    const f = await fixture(t, replacement, { fetchImpl: api(calls, state) })
    assert.equal((await f.ipc()).highlight.cover.length, 'data:image/jpeg;base64,'.length + state.cover.toString('base64').length)
    let failed = true
    const controlled = api([], {})
    const retry = await fixture(t, replacement, { fetchImpl: (url, options) => {
      if (!options?.body && failed) throw Error('cover offline')
      return controlled(url, options)
    } })
    assert.equal((await retry.ipc()).highlight.cover, '')
    failed = false
    assert.match((await retry.ipc()).highlight.cover, /^data:image\/jpeg;base64,/)
  })

  test(`${name} preserves four-book cooldown and bounded notebook synchronization`, async t => {
    const cached = await fixture(t, replacement, { cache: { version: 2, syncedAt: timestamp,
      highlights: ['A', 'B', 'C', 'D', 'E'].map(title => ({ title, markText: title })) },
      fetchImpl() { throw Error('fresh cache must not synchronize') },
    })
    assert.equal(cached.host.get(DATA_PORTS.weread).snapshot().highlight.title, 'A')
    const titles = []
    for (let index = 0; index < 6; index++) titles.push((await cached.ipc()).highlight.title)
    assert.deepEqual(titles, ['B', 'C', 'D', 'E', 'A', 'B'])
    const requests = []
    const bounded = await fixture(t, replacement, { fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body)
      requests.push(body)
      return { ok: true, json: async () => body.api_name === '/user/notebooks'
        ? { books: Array.from({ length: 10 }, (_entry, index) => ({ bookId: String(index), noteCount: 3, book: { title: `Book ${index}` } })) }
        : { updated: Array.from({ length: 3 }, (_entry, index) => ({ type: 1, markText: `Text ${body.bookId}-${index}`, createTime: Number(body.bookId) * 3 + index })) } }
    } })
    await bounded.ipc()
    assert.equal(requests.length, 9)
    assert.deepEqual(requests.slice(1).map(body => body.bookId), ['0', '1', '2', '3', '4', '5', '6', '7'])
    const saved = JSON.parse(fs.readFileSync(bounded.cacheFile, 'utf8'))
    assert.equal(saved.highlights.length, 20)
    assert.equal(saved.highlights[0].markText, 'Text 7-2')
    assert.equal(saved.highlights.at(-1).markText, 'Text 1-1')
  })

  test(`${name} preserves API errors and tolerates cache read and write failures`, async t => {
    for (const [response, error] of [
      [{ ok: false, status: 503 }, 'WeRead request failed (503)'],
      [{ ok: true, json: async () => ({ errcode: 7, errmsg: 'controlled rejection' }) }, 'controlled rejection'],
      [{ ok: true, json: async () => ({ errcode: 8 }) }, 'WeRead error (8)'],
    ]) {
      const f = await fixture(t, replacement, { fetchImpl: async () => response })
      assert.equal((await f.ipc()).error, error)
    }
    const f = await fixture(t, replacement, { fetchImpl: api([], {}), fsImpl: {
      readFileSync() { throw Error('corrupt cache') }, mkdirSync() {}, writeFileSync() { throw Error('read-only cache') },
    } })
    assert.equal((await f.ipc()).status, 'live')
  })

  test(`${name} rejects invalid cache schemas and preserves random selection endpoints`, async t => {
    for (const cache of [{ version: 1, highlights: [{ title: 'Old', markText: 'Old' }] },
      { version: 2, highlights: {} }, { version: 2, highlights: [null, { title: 'Missing text' }, { markText: 'Missing title' }] }]) {
      const f = await fixture(t, replacement, { cache, fetchImpl: api([], {}) })
      assert.equal(f.host.get(DATA_PORTS.weread).snapshot().status, 'loading')
      assert.equal((await f.ipc()).status, 'live')
    }
    const f = await fixture(t, replacement, { random: () => 0.999999, fetchImpl: api([], {}) })
    assert.equal((await f.ipc()).highlight.title, 'Book 1')
    assert.equal((await f.ipc()).highlight.title, 'Book 2')
  })

  for (const stage of ['notebook', 'cover', 'bookmark sibling', 'notebook body', 'cover body']) {
    test(`${name} drains ${stage} requests before replacement without late state or cache writes`, async t => {
      let entered
      const ready = new Promise(resolve => { entered = resolve })
      let resolveRequest
      let signal
      const controlled = api([], {})
      const f = await fixture(t, replacement, { fetchImpl: (url, options) => {
        const body = options?.body ? JSON.parse(options.body) : null
        if ((stage === 'notebook body' && body?.api_name === '/user/notebooks') || (stage === 'cover body' && !body)) {
          signal = options.signal
          const pendingBody = () => { entered(); return new Promise(resolve => { resolveRequest = resolve }) }
          return stage === 'notebook body' ? { ok: true, json: pendingBody }
            : { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: pendingBody }
        }
        const block = stage === 'notebook' ? body?.api_name === '/user/notebooks'
          : stage === 'cover' ? !body : body?.bookId === '2'
        if (block) {
          signal = options?.signal
          entered()
          return new Promise(resolve => { resolveRequest = resolve })
        }
        if (stage === 'bookmark sibling' && body?.bookId === '1') throw Error('bookmark failed')
        return controlled(url, options)
      } })
      const old = f.host.get(DATA_PORTS.weread)
      const refresh = f.ipc()
      await ready
      if (stage === 'bookmark sibling') assert.equal((await refresh).status, 'error')
      const before = structuredClone(old.snapshot())
      const cache = fs.existsSync(f.cacheFile) ? fs.readFileSync(f.cacheFile) : null
      const disable = f.host.setEnabled('odk.source.weread', false)
      let enabled = false
      const enable = f.host.setEnabled('odk.source.weread', true).then(() => { enabled = true })
      await new Promise(resolve => setImmediate(resolve))
      // Release the controlled transport even if a regression assertion fails.
      try {
        assert.equal(signal?.aborted, true)
        assert.equal(enabled, false, 'new source must wait for the old transport')
      } finally {
        resolveRequest(stage === 'notebook body' ? { books: [] } : stage === 'cover body' ? Buffer.from('late') : stage === 'cover'
          ? { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Buffer.from('late') }
          : { ok: true, json: async () => stage === 'notebook' ? { books: [] } : { updated: [] } })
      }
      await Promise.all([refresh, disable, enable])
      assert.deepEqual(old.snapshot(), before)
      assert.deepEqual(await old.refresh(), before, 'stopped sources must not start another request')
      assert.deepEqual(fs.existsSync(f.cacheFile) ? fs.readFileSync(f.cacheFile) : null, cache)
      assert.notEqual(f.host.get(DATA_PORTS.weread), old)
      assert.equal(f.handlers.size, 1)
    })
  }

  test(`${name} retains concurrent consumer selection and reverse completion order`, async t => {
    let time = timestamp
    const pending = new Map()
    const cache = { version: 2, syncedAt: time, highlights: ['A', 'B'].map(title => ({ title, markText: title, cover: `https://controlled/${title}` })) }
    const f = await fixture(t, replacement, { cache, now: () => time, fetchImpl: (url, options) => {
      assert.equal(options.signal.aborted, false)
      return new Promise(resolve => pending.set(url, resolve))
    } })
    const ipc = f.ipc()
    time++
    const read = f.read()
    await new Promise(resolve => setImmediate(resolve))
    const response = { ok: true, headers: { get: () => 'image/jpeg' }, arrayBuffer: async () => Buffer.from('cover') }
    try {
      assert.deepEqual([...pending.keys()], ['https://controlled/B', 'https://controlled/A'])
      pending.get('https://controlled/A')(response)
      const reading = (await read).reading
      assert.equal(reading.value.book.title, 'A')
      assert.equal(reading.updatedAt, timestamp + 1)
      pending.get('https://controlled/B')(response)
      const snapshot = await ipc
      assert.equal(snapshot.highlight.title, 'B')
      assert.equal(snapshot.updatedAt, timestamp)
      assert.deepEqual(f.host.get(DATA_PORTS.weread).snapshot(), snapshot)
    } finally {
      for (const resolve of pending.values()) resolve(response)
      await Promise.allSettled([ipc, read])
    }
  })
}

test('corrupt signed WeRead restores actual default IPC, readings, and health before factory execution', async t => {
  const cache = { version: 2, syncedAt: timestamp, highlights: [{ title: 'Cached English 与中文', markText: 'Saved\nSecond line' }] }
  const options = { apiKey: '', cache, fetchImpl() { throw Error('Cached unconfigured fixture must not contact the provider') } }
  const baseline = await fixture(t, false, options)
  const corrupt = await fixture(t, 'signed', { ...options, corruptBeforeLoad: true })
  assert.equal(corrupt.created(), 1)
  assert.equal(corrupt.reports.length, 1)
  assert.equal(corrupt.reports[0].id, 'odk.source.weread')
  assert.match(corrupt.reports[0].error.message, /native file hash mismatch/)
  assert.deepEqual(await corrupt.ipc(), await baseline.ipc())
  assert.deepEqual(await corrupt.read(), await baseline.read())
  assert.deepEqual(corrupt.health(), baseline.health())
  await assert.rejects(corrupt.native.store.read(corrupt.native.stored.revision), /native file hash mismatch/)
})

for (const selection of [true, 'signed']) test(`removing ${selection === 'signed' ? 'signed' : 'linked'} independent WeRead restores default consumers and preserves its package`, async t => {
  const f = await fixture(t, selection, { apiKey: '', mutateStored: false,
    cache: { version: 2, syncedAt: timestamp, highlights: [{ title: 'Cached English 与中文', markText: 'Saved\nSecond line' }] },
    fetchImpl() { throw Error('Cached unconfigured fixture must not contact the provider') },
  })
  const baseline = { ipc: await f.ipc(), reading: await f.read(), health: f.health() }
  const entry = path.join(directory, 'entry.cjs')
  const bytes = fs.readFileSync(entry)
  const retained = f.native ? await f.native.store.snapshot(f.native.stored.revision) : null
  await f.host.stop()
  assert.equal(f.handlers.size, 0)
  assert.equal(f.host.list().some(record => ['cleanup-failed', 'cleanup-blocked'].includes(record.state)), false)
  if (f.native) {
    const receipt = JSON.parse((await f.native.command(['remove', 'odk.source.weread'])).stdout)
    assert.equal(receipt.effect, 'selection-only')
    assert.equal(f.native.config().plugins['odk.source.weread']?.native, undefined)
    assert.deepEqual(await f.native.load(), [])
    const after = await f.native.store.snapshot(f.native.stored.revision)
    assert.deepEqual([...after.files], [...retained.files])
    assert.deepEqual(fs.readFileSync(path.join(after.root, 'bundle.json')), fs.readFileSync(path.join(f.native.directory, 'bundle.json')))
  } else await run(process.execPath, [cli, 'remove', 'odk.source.weread'], { env: f.env })
  assert.deepEqual(loadDevelopmentPlugins(readConfig(resolveConfigPath(f.env))), [])
  assert.deepEqual(fs.readFileSync(entry), bytes)
  const handlers = new Map()
  let created = 0
  const restored = createPluginHost({ capabilities: {
    ipc: { handle: (name, handler) => handlers.set(name, handler), removeHandler: name => handlers.delete(name) },
    'source.weread': { options: f.configuration, create(options) { created++; return createWeReadSource(options) } },
    'desk.data': { create: createShellDeskData, smokeMode: true },
  } })
  t.after(() => restored.stop())
  createMainPlugins().filter(plugin => ['odk.source.weread', 'odk.system.desk-data'].includes(plugin.manifest.id))
    .forEach(plugin => restored.register(plugin))
  await restored.start()
  assert.equal(created, 1)
  assert.equal(restored.get(DATA_PORTS.weread).fixtureRevision, undefined)
  assert.deepEqual(await handlers.get('odk-weread-highlight')(null), baseline.ipc)
  assert.deepEqual(await restored.get(DESK_PORTS.data).control.dispatch({ command: 'read', readingId: 'odk.tile.weread' }), baseline.reading)
  assert.deepEqual(restored.get(healthPort('odk.source.weread')).snapshot(), baseline.health)
})
