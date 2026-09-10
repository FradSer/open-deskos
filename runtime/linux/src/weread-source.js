const API_URL = 'https://i.weread.qq.com/api/agent/gateway'
const SKILL_VERSION = '1.0.4'
const RECENT_LIMIT = 20
const RESYNC_MS = 30 * 60 * 1000
const MAX_COVER_BYTES = 512 * 1024
const CACHE_VERSION = 2

function createWeReadSource({
  fetchImpl = fetch,
  apiKey = process.env.WEREAD_API_KEY,
  now = () => Date.now(),
  random = Math.random,
  cacheFile,
  fsImpl = require('node:fs'),
} = {}) {
  let state = { status: apiKey ? 'loading' : 'unconfigured', highlight: null, updatedAt: null }
  let recents = []
  let lastSync = 0
  let lastIndex = -1
  const recentBooks = []
  const BOOK_COOLDOWN = 4
  const coverCache = new Map()

  loadCache()

  function loadCache() {
    if (!cacheFile) return
    try {
      const cached = JSON.parse(fsImpl.readFileSync(cacheFile, 'utf8'))
      if (cached.version !== CACHE_VERSION || !Array.isArray(cached.highlights)) return
      recents = cached.highlights.filter((entry) => entry?.markText && entry?.title)
      lastSync = Number(cached.syncedAt) || 0
      if (recents.length) state = { status: 'live', highlight: pickRandom(), updatedAt: now() }
    } catch {
      // A missing or corrupt cache is replaced by the next successful sync.
    }
  }

  function saveCache() {
    if (!cacheFile || !recents.length) return
    try {
      fsImpl.mkdirSync(require('node:path').dirname(cacheFile), { recursive: true })
      fsImpl.writeFileSync(cacheFile, JSON.stringify({ version: CACHE_VERSION, syncedAt: lastSync, highlights: recents }), { mode: 0o600 })
    } catch {
      // Cache failure must not prevent live WeRead data from displaying.
    }
  }

  function pickRandom() {
    if (!recents.length) return null
    const available = recents
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => {
        if (index === lastIndex && recents.length > 1) return false
        return !recentBooks.includes(entry.title) || recents.every((candidate) => recentBooks.includes(candidate.title))
      })
    const pool = available.length ? available : recents.map((entry, index) => ({ entry, index }))
    const selected = pool[Math.floor(random() * pool.length)]
    lastIndex = selected.index
    const bookIndex = recentBooks.indexOf(selected.entry.title)
    if (bookIndex !== -1) recentBooks.splice(bookIndex, 1)
    recentBooks.push(selected.entry.title)
    if (recentBooks.length > BOOK_COOLDOWN) recentBooks.shift()
    return selected.entry
  }

  async function request(body) {
    const response = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, skill_version: SKILL_VERSION }),
    })
    if (!response.ok) throw new Error(`WeRead request failed (${response.status})`)
    const payload = await response.json()
    if (payload.errcode) throw new Error(payload.errmsg || `WeRead error (${payload.errcode})`)
    return payload
  }

  async function resolveCover(remoteUrl) {
    if (!remoteUrl) return ''
    if (coverCache.has(remoteUrl)) return coverCache.get(remoteUrl)
    try {
      const coverResponse = await fetchImpl(remoteUrl)
      const contentType = coverResponse.headers?.get?.('content-type') || 'image/jpeg'
      if (coverResponse.ok && contentType.startsWith('image/')) {
        const bytes = Buffer.from(await coverResponse.arrayBuffer())
        if (bytes.length > 0 && bytes.length <= MAX_COVER_BYTES) {
          const dataUrl = `data:${contentType.split(';')[0]};base64,${bytes.toString('base64')}`
          if (coverCache.size >= RECENT_LIMIT * 2) coverCache.clear()
          coverCache.set(remoteUrl, dataUrl)
          return dataUrl
        }
      }
    } catch {
      // Fall through to hidden cover; the cached remote URL is kept for retry.
    }
    return ''
  }

  async function refresh() {
    if (!apiKey) return state
    const nowMs = now()
    try {
      if (recents.length === 0 || nowMs - lastSync >= RESYNC_MS) {
        const notebooks = await request({ api_name: '/user/notebooks', count: 100 })
        const books = notebooks.books || []
        const candidates = books.filter((entry) => entry.bookId && entry.noteCount).slice(0, 8)
        const results = await Promise.all(candidates.map(async (entry) => {
          const notes = await request({ api_name: '/book/bookmarklist', bookId: entry.bookId })
          return (notes.updated || [])
            .filter((note) => note.type === 1 && note.markText && !/^\[插[图画]\]$/.test(note.markText.trim()))
            .map((note) => ({ ...note, title: entry.book?.title || '微信读书', author: entry.book?.author || entry.book?.writer || '', cover: entry.book?.cover || entry.book?.coverUrl || '' }))
        }))
        const highlights = results.flat()
        highlights.sort((a, b) => (b.createTime || 0) - (a.createTime || 0))
        recents = highlights.slice(0, RECENT_LIMIT)
        coverCache.clear()
        lastSync = nowMs
        lastIndex = -1
        recentBooks.length = 0
        saveCache()
      }
      const entry = pickRandom()
      const highlight = entry ? { ...entry, cover: await resolveCover(entry.cover) } : null
      state = { status: highlight ? 'live' : 'empty', highlight, updatedAt: nowMs }
    } catch (error) {
      state = { status: 'error', highlight: null, updatedAt: nowMs, error: error.message }
    }
    return state
  }

  return { refresh, snapshot: () => state }
}

module.exports = { createWeReadSource }
