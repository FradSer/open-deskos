import { createHash } from 'node:crypto'
import { GMAIL_SCOPE, readGmailCredentials } from './credentials.mjs'

export class GmailError extends Error {
  constructor(code) {
    const messages = {
      unconfigured: 'Gmail 尚未连接，请在服务主机完成 Google 授权。',
      needs_reconnect: 'Gmail 授权已失效，请重新连接。',
      credentials_unsafe: 'Gmail 凭据不可用或权限不安全，请检查服务主机配置。',
      invalid_request: 'Gmail 请求参数无效。',
      unavailable: 'Gmail 暂时不可用，请稍后重试。',
      rate_limited: 'Gmail 请求受到限流，请稍后重试。',
      response_too_large: '邮件内容超过读取上限，请在 Gmail 中查看。',
      cancelled: 'Gmail 请求已取消。',
      account_changed: 'Gmail 连接账户已变化，请重新检查当前账户。',
    }
    super(messages[code] ?? messages.unavailable)
    this.code = code
  }
}
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const accountKey = value => value === undefined || (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
const text = (value, max = 1024) => typeof value === 'string' ? value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, max) : ''
const boundedInteger = (value, min, max) => Number.isInteger(value) && value >= min && value <= max

/** Never interpret HTML, fetch images, or expose attachment bytes. */
function htmlText(value) {
  const chunks = []
  let cursor = 0, suppressed, incomplete = false
  while (cursor < value.length) {
    if (suppressed) {
      let closing = value.indexOf('</', cursor)
      while (closing >= 0 && (value.slice(closing + 2, closing + 2 + suppressed.length).toLowerCase() !== suppressed
        || !/[\s/>]/.test(value[closing + 2 + suppressed.length] ?? '>'))) closing = value.indexOf('</', closing + 2)
      if (closing < 0) { incomplete = true; break }
      cursor = closing
      suppressed = undefined
    }
    const opening = value.indexOf('<', cursor)
    if (opening < 0) { chunks.push(value.slice(cursor)); break }
    chunks.push(value.slice(cursor, opening))
    if (value.startsWith('<!--', opening)) {
      const end = value.indexOf('-->', opening + 4)
      if (end < 0) { incomplete = true; break }
      cursor = end + 3
      continue
    }
    let end = opening + 1, quote
    for (; end < value.length; end++) {
      const character = value[end]
      if (quote) { if (character === quote) quote = undefined }
      else if (character === '"' || character === "'") quote = character
      else if (character === '>') break
    }
    if (end === value.length) { incomplete = true; break }
    let nameStart = opening + 1
    while (nameStart < end && /\s/.test(value[nameStart])) nameStart++
    const closingTag = value[nameStart] === '/'
    if (closingTag) {
      nameStart++
      while (nameStart < end && /\s/.test(value[nameStart])) nameStart++
    }
    const tag = /^([a-z][a-z0-9:-]*)/i.exec(value.slice(nameStart, end))
    const name = tag?.[1].toLowerCase()
    if (tag && !closingTag && ['script', 'style', 'head'].includes(name)) suppressed = name
    else if (name && /^(?:p|div|br|li|tr|h[1-6])$/.test(name)) chunks.push('\n')
    cursor = end + 1
  }
  return { incomplete, body: chunks.join('').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity.startsWith('#')) {
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10)
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
      }
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity.toLowerCase()] ?? match
    }).trim() }
}

function messageBody(payload) {
  let attachmentsOmitted = false, truncated = false, visited = 0
  function decode(part, depth = 0) {
    const empty = { body: '', plain: false }
    if (!part || typeof part !== 'object') return empty
    if (++visited > 512 || depth > 32) { truncated = true; return empty }
    const headers = Array.isArray(part.headers) ? part.headers : []
    if (part.filename || headers.some(header => String(header.name).toLowerCase() === 'content-disposition' && /^attachment\b/i.test(header.value))) {
      attachmentsOmitted = true; return empty
    }
    const mime = String(part.mimeType).toLowerCase()
    if (Array.isArray(part.parts)) {
      if (part.parts.length > 512) truncated = true
      const children = part.parts.slice(0, 512).map(part => decode(part, depth + 1))
      if (mime === 'multipart/alternative') return children.find(child => child.plain && child.body) ?? children.find(child => child.body) ?? empty
      return { body: children.map(child => child.body).filter(Boolean).join('\n'), plain: children.some(child => child.plain) }
    }
    if (!['text/plain', 'text/html'].includes(mime) || part.body?.attachmentId) {
      if (part.body?.attachmentId || part.body?.data) attachmentsOmitted = true
      return empty
    }
    if (typeof part.body?.data !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(part.body.data)) {
      if (part.body?.size > 0) truncated = true
      return empty
    }
    const contentType = headers.find(header => String(header.name).toLowerCase() === 'content-type')?.value ?? ''
    const charset = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1] ?? 'utf-8'
    let decoded
    try { decoded = new TextDecoder(charset).decode(Buffer.from(part.body.data, 'base64url')) }
    catch { truncated = true; return empty }
    const converted = mime === 'text/plain' ? { body: decoded, incomplete: false } : htmlText(decoded)
    truncated ||= converted.incomplete
    return { body: converted.body, plain: mime === 'text/plain' }
  }
  const { body } = decode(payload)
  return { body: text(body, 16000), truncated: truncated || body.length > 16000, attachmentsOmitted }
}

function publicMessage(value, id) {
  if (!value || value.id !== id || !value.payload || typeof value.payload !== 'object') throw new GmailError('unavailable')
  const headers = Array.isArray(value.payload.headers) ? value.payload.headers : []
  const header = name => text(headers.find(item => String(item.name).toLowerCase() === name)?.value)
  return { id, ...(identifier(value.threadId) ? { threadId: value.threadId } : {}),
    subject: header('subject'), from: header('from'), to: header('to'), date: header('date'),
    internalDate: /^\d{1,16}$/.test(value.internalDate) ? value.internalDate : null,
    snippet: text(value.snippet), labels: Array.isArray(value.labelIds) ? value.labelIds.slice(0, 100).map(label => text(label, 128)) : [],
    ...messageBody(value.payload), untrusted: true }
}

/** Fixed read-only Gmail endpoints. Credentials and access tokens never enter tool results. */
export function createGmailClient({ credentialsFile, signal = undefined, fetchImpl = fetch, timeoutMs = 15000 }) {
  const lifetime = new AbortController()
  let cached, refreshing
  function check(requestSignal) {
    if (lifetime.signal.aborted || signal?.aborted || requestSignal?.aborted) throw new GmailError('cancelled')
  }
  function waitForRefresh(promise, requestSignal) {
    check(requestSignal)
    const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : []), ...(requestSignal ? [requestSignal] : [])])
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new GmailError('cancelled'))
      combined.addEventListener('abort', aborted, { once: true })
      promise.then(value => { combined.removeEventListener('abort', aborted); resolve(value) },
        error => { combined.removeEventListener('abort', aborted); reject(error) })
    })
  }
  function credentials() {
    check(signal)
    try { return readGmailCredentials(credentialsFile) } catch { throw new GmailError('credentials_unsafe') }
  }
  function stillCurrent(expected) {
    const current = credentials()
    if (!current) { cached = undefined; throw new GmailError('unconfigured') }
    if (fingerprint(current) !== fingerprint(expected)) { cached = undefined; throw new GmailError('needs_reconnect') }
  }
  async function request(url, options, requestSignal, limit = 2 * 1024 * 1024) {
    check(requestSignal)
    const combined = AbortSignal.any([lifetime.signal, ...(signal ? [signal] : []), ...(requestSignal ? [requestSignal] : []), AbortSignal.timeout(timeoutMs)])
    try {
      const response = await fetchImpl(url, { ...options, redirect: 'error', signal: combined })
      check(requestSignal)
      if (Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new GmailError('response_too_large') }
      const reader = response.body?.getReader()
      const chunks = []
      let size = 0
      if (reader) try {
        while (true) {
          combined.throwIfAborted()
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.length
          if (size > limit) { await reader.cancel(); throw new GmailError('response_too_large') }
          chunks.push(chunk.value)
        }
      } finally { reader.releaseLock() }
      combined.throwIfAborted()
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!response.ok) {
        if (response.status === 401 || value?.error === 'invalid_grant' || (response.status === 403 && value?.error?.status === 'PERMISSION_DENIED')) { cached = undefined; throw new GmailError('needs_reconnect') }
        throw new GmailError(response.status === 429 ? 'rate_limited' : 'unavailable')
      }
      return value
    } catch (error) {
      if (error instanceof GmailError) throw error
      check(requestSignal)
      throw new GmailError('unavailable')
    }
  }
  async function accessToken(grant, requestSignal) {
    const key = fingerprint(grant)
    if (cached?.key === key && cached.expiresAt > Date.now() + 60000) return cached.token
    if (!refreshing || refreshing.key !== key) {
      const promise = (async () => {
        const value = await request('https://oauth2.googleapis.com/token', { method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
            client_id: grant.clientId, client_secret: grant.clientSecret, refresh_token: grant.refreshToken, grant_type: 'refresh_token',
          }) }, undefined, 32768)
        stillCurrent(grant)
        if (typeof value.access_token !== 'string' || !/^[\x21-\x7e]{1,8192}$/.test(value.access_token)
          || String(value.token_type).toLowerCase() !== 'bearer' || !boundedInteger(value.expires_in, 1, 86400)
          || (value.scope !== undefined && value.scope !== GMAIL_SCOPE)) throw new GmailError('needs_reconnect')
        cached = { key, token: value.access_token, expiresAt: Date.now() + value.expires_in * 1000 }
        return cached.token
      })()
      const current = { key, promise }
      refreshing = current
      void promise.finally(() => { if (refreshing === current) refreshing = undefined }).catch(() => {})
    }
    const token = await waitForRefresh(refreshing.promise, requestSignal)
    check(requestSignal)
    return token
  }
  async function get(path, params, requestSignal, expectedAccountKey = undefined) {
    check(requestSignal)
    const grant = credentials()
    if (!grant) throw new GmailError('unconfigured')
    const token = await accessToken(grant, requestSignal)
    check(requestSignal)
    stillCurrent(grant)
    // Both requests use this captured grant and token. Separate status calls
    // cannot bind an observation when accounts change between MCP calls.
    async function pinnedRead(selectedPath, selectedParams) {
      check(requestSignal)
      stillCurrent(grant)
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/${selectedPath}`)
      for (const [key, value] of Object.entries(selectedParams)) if (value !== undefined) url.searchParams.set(key, String(value))
      const result = await request(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` } }, requestSignal)
      check(requestSignal)
      stillCurrent(grant)
      return result
    }
    if (expectedAccountKey !== undefined) {
      const profile = await pinnedRead('profile', {})
      if (typeof profile?.emailAddress !== 'string' || profile.emailAddress.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(profile.emailAddress)) throw new GmailError('unavailable')
      if (fingerprint(['gmail-account', profile.emailAddress.toLowerCase()]) !== expectedAccountKey) throw new GmailError('account_changed')
    }
    return pinnedRead(path, params)
  }
  return {
    async status({ signal: requestSignal = undefined } = {}) {
      check(requestSignal)
      if (!credentials()) return { state: 'unconfigured' }
      try {
        const value = await get('profile', {}, requestSignal)
        if (typeof value.emailAddress !== 'string' || !value.emailAddress.includes('@')) throw new GmailError('unavailable')
        return { state: 'connected', emailAddress: text(value.emailAddress, 320) }
      } catch (error) { if (error instanceof GmailError && error.code === 'needs_reconnect') return { state: 'needs_reconnect' }; throw error }
    },
    async search({ query, maxResults = 10, pageToken = undefined, expectedAccountKey = undefined, signal: requestSignal = undefined }) {
      if (typeof query !== 'string' || query.length < 1 || query.length > 1024 || /[\x00-\x1f\x7f]/.test(query)
        || !accountKey(expectedAccountKey) || !boundedInteger(maxResults, 1, 20) || (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length < 1 || pageToken.length > 2048 || /[\x00-\x1f\x7f]/.test(pageToken)))) throw new GmailError('invalid_request')
      const value = await get('messages', { q: query, maxResults, pageToken }, requestSignal, expectedAccountKey)
      if (!value || typeof value !== 'object' || (value.messages !== undefined && !Array.isArray(value.messages))) throw new GmailError('unavailable')
      return { messages: (value.messages ?? []).slice(0, maxResults).map(item => {
        if (!identifier(item?.id) || (item.threadId !== undefined && !identifier(item.threadId))) throw new GmailError('unavailable')
        return { id: item.id, ...(item.threadId ? { threadId: item.threadId } : {}) }
      }), nextPageToken: text(value.nextPageToken, 2048) || null,
      resultSizeEstimate: boundedInteger(value.resultSizeEstimate, 0, Number.MAX_SAFE_INTEGER) ? value.resultSizeEstimate : null, untrusted: true }
    },
    async read({ id, expectedAccountKey = undefined, signal: requestSignal = undefined }) {
      if (!identifier(id) || !accountKey(expectedAccountKey)) throw new GmailError('invalid_request')
      return publicMessage(await get(`messages/${encodeURIComponent(id)}`, { format: 'full' }, requestSignal, expectedAccountKey), id)
    },
    close() { cached = undefined; lifetime.abort() },
  }
}
