'use strict'

// Independent source implementation for controlled compatibility checks.
// Only the public reading projection is shared with the consumer.
const { createWereadReadings, getWereadHealth } = require('../../../src/plugins/readings/weread')
const path = require('node:path')

function source(options) {
  const { apiKey = process.env.WEREAD_API_KEY, fetchImpl = fetch, now = Date.now,
    random = Math.random, cacheFile, fsImpl = require('node:fs'), signal } = options
  const lifetime = new AbortController()
  const active = new Set()
  const cancel = () => lifetime.abort()
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  function track(pending) {
    active.add(pending)
    const release = () => active.delete(pending)
    void pending.then(release, release)
    return pending
  }
  let entries = []
  let synced = 0
  let previous = -1
  const books = []
  const covers = new Map()
  let current = { status: apiKey ? 'loading' : 'unconfigured', highlight: null, updatedAt: null }

  function choose() {
    if (!entries.length) return null
    const allBooksRecent = entries.every(entry => books.includes(entry.title))
    let indices = entries.flatMap((entry, index) =>
      (entries.length === 1 || index !== previous) && (allBooksRecent || !books.includes(entry.title)) ? [index] : [])
    if (!indices.length) indices = entries.map((_entry, index) => index)
    previous = indices[Math.floor(random() * indices.length)]
    const entry = entries[previous]
    const recent = books.indexOf(entry.title)
    if (recent >= 0) books.splice(recent, 1)
    books.push(entry.title)
    if (books.length > 4) books.shift()
    return entry
  }

  if (cacheFile) {
    try {
      const saved = JSON.parse(fsImpl.readFileSync(cacheFile, 'utf8'))
      if (saved.version === 2 && Array.isArray(saved.highlights)) {
        entries = saved.highlights.filter(entry => entry?.markText && entry?.title)
        synced = Number(saved.syncedAt) || 0
        if (entries.length) current = { status: 'live', highlight: choose(), updatedAt: now() }
      }
    } catch { /* Cache failure leaves the next refresh responsible for synchronization. */ }
  }

  function request(body) { return track(requestCurrent(body)) }
  async function requestCurrent(body) {
    lifetime.signal.throwIfAborted()
    const response = await fetchImpl('https://i.weread.qq.com/api/agent/gateway', {
      method: 'POST', signal: lifetime.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, skill_version: '1.0.4' }),
    })
    lifetime.signal.throwIfAborted()
    if (!response.ok) throw Error(`WeRead request failed (${response.status})`)
    const value = await response.json()
    lifetime.signal.throwIfAborted()
    if (value.errcode) throw Error(value.errmsg || `WeRead error (${value.errcode})`)
    return value
  }

  function cover(url) { return track(coverCurrent(url)) }
  async function coverCurrent(url) {
    if (lifetime.signal.aborted) return ''
    if (!url) return ''
    if (covers.has(url)) return covers.get(url)
    try {
      const response = await fetchImpl(url, { signal: lifetime.signal })
      if (lifetime.signal.aborted) return ''
      const type = response.headers?.get?.('content-type') || 'image/jpeg'
      if (response.ok && type.startsWith('image/')) {
        const bytes = Buffer.from(await response.arrayBuffer())
        if (lifetime.signal.aborted) return ''
        if (bytes.length && bytes.length <= 512 * 1024) {
          const value = `data:${type.split(';')[0]};base64,${bytes.toString('base64')}`
          if (covers.size >= 40) covers.clear()
          covers.set(url, value)
          return value
        }
      }
    } catch { /* Hidden covers remain eligible for retry. */ }
    return ''
  }

  async function refreshCurrent() {
    if (!apiKey || lifetime.signal.aborted) return current
    const time = now()
    try {
      if (!entries.length || time - synced >= 30 * 60 * 1000) {
        const notebooks = await request({ api_name: '/user/notebooks', count: 100 })
        const selected = (notebooks.books || []).filter(book => book.bookId && book.noteCount).slice(0, 8)
        const groups = await Promise.all(selected.map(async book => {
          const notes = await request({ api_name: '/book/bookmarklist', bookId: book.bookId })
          return (notes.updated || []).flatMap(note => {
            if (note.type !== 1 || !note.markText || /^\[插[图画]\]$/.test(note.markText.trim())) return []
            return [{ ...note, title: book.book?.title || '微信读书',
              author: book.book?.author || book.book?.writer || '', cover: book.book?.cover || book.book?.coverUrl || '' }]
          })
        }))
        if (lifetime.signal.aborted) return current
        entries = groups.flat().sort((a, b) => (b.createTime || 0) - (a.createTime || 0)).slice(0, 20)
        synced = time
        previous = -1
        books.length = 0
        covers.clear()
        if (cacheFile && entries.length) {
          try {
            fsImpl.mkdirSync(path.dirname(cacheFile), { recursive: true })
            fsImpl.writeFileSync(cacheFile, JSON.stringify({ version: 2, syncedAt: synced, highlights: entries }), { mode: 0o600 })
          } catch { /* Cache writes must not prevent live readings. */ }
        }
      }
      const selected = choose()
      const highlight = selected ? { ...selected, cover: await cover(selected.cover) } : null
      if (lifetime.signal.aborted) return current
      current = { status: highlight ? 'live' : 'empty', highlight, updatedAt: time }
    } catch (error) {
      if (lifetime.signal.aborted) return current
      current = { status: 'error', highlight: null, updatedAt: time, error: error.message }
    }
    return current
  }
  function refresh() { return track(refreshCurrent()) }
  async function stop() {
    cancel()
    signal?.removeEventListener('abort', cancel)
    await Promise.allSettled([...active])
  }
  return { refresh, snapshot: () => current, stop }
}

exports.create = context => {
  const provider = source({ ...context.capability('source.weread').options, signal: context.signal })
  context.onCleanup(() => provider.stop())
  const ipc = context.capability('ipc')
  ipc.handle('odk-weread-highlight', async () => { await provider.refresh(); return provider.snapshot() })
  context.onCleanup(() => ipc.removeHandler('odk-weread-highlight'))
  return { ports: {
    'odk:source/weread/v1': provider,
    'odk:desk-reading/weread/v1': createWereadReadings(provider),
    'odk:plugin-health/odk.source.weread/v1': { snapshot: () => getWereadHealth(provider) },
  } }
}
