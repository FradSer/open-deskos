const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')

const DEFAULT_BASE_URL = 'https://opencode.ai'
const DEFAULT_TIMEOUT_MS = 10000
const USER_AGENT = 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
const WORKSPACES_SERVER_ID = 'def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f'
const BILLING_SERVER_ID = 'c83b78a614689c38ebee981f9b39a8b377716db85c1fd7dbab604adc02d3313d'

function resolveOpenCodeGoConfig(env = process.env, fileSystem = fs) {
  const baseUrl = (env.ODK_OPENCODE_GO_URL || DEFAULT_BASE_URL).trim()
  let cookie = env.ODK_OPENCODE_COOKIE?.trim() || readCookieFile(env.ODK_OPENCODE_COOKIE_FILE, fileSystem)
  if (!cookie) {
    const defaultPaths = [
      '/etc/open-deskos/opencode-go.cookie',
      env.HOME ? `${env.HOME}/.config/open-deskos/opencode-go.cookie` : null,
      env.HOME ? `${env.HOME}/.open-deskos/opencode-go.cookie` : null,
    ].filter(Boolean)
    for (const filePath of defaultPaths) {
      const candidate = readCookieFile(filePath, fileSystem)
      if (candidate) {
        cookie = candidate
        break
      }
    }
  }
  const missing = []
  if (!baseUrl) {
    missing.push('ODK_OPENCODE_GO_URL')
  } else {
    try {
      const url = new URL(baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
    } catch {
      missing.push('valid ODK_OPENCODE_GO_URL')
    }
  }
  if (!cookie) missing.push('ODK_OPENCODE_COOKIE or ODK_OPENCODE_COOKIE_FILE')
  return {
    baseUrl: baseUrl || null,
    cookie: cookie || null,
    configured: missing.length === 0,
    missing,
  }
}

function readCookieFile(filePath, fileSystem) {
  if (!filePath?.trim()) return ''
  try {
    return fileSystem.readFileSync(filePath.trim(), 'utf8').trim()
  } catch {
    return ''
  }
}

function filterCookie(rawCookie) {
  return rawCookie.split(';').map((part) => part.trim()).filter((part) => {
    const name = part.split('=', 1)[0]
    return name === 'auth' || name === '__Host-auth'
  }).join('; ')
}

function firstMatch(pattern, text, group = 1) {
  const match = text.match(pattern)
  return match?.[group] ?? null
}

function percent(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null
}

function parseUsagePage(page) {
  if (typeof page !== 'string' || page.length === 0) throw new Error('usage page is empty')
  const rollingPct = percent(firstMatch(/rollingUsage[^}]*?usagePercent\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/, page))
  if (rollingPct === null) throw new Error('usage page has no rolling usage')
  const resetSec = firstMatch(/rollingUsage[^}]*?resetInSec\s*[:=]\s*([0-9]+)/, page)
  const weekPct = percent(firstMatch(/weeklyUsage[^}]*?usagePercent\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/, page))
  const monthPct = percent(firstMatch(/monthlyUsage[^}]*?usagePercent\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/, page))
  return {
    plan: 'opencode-go',
    rollingPct,
    rollingResetMin: resetSec === null ? null : Math.floor(Number(resetSec) / 60),
    weekPct,
    monthPct,
  }
}

function findWorkspaceId(value) {
  if (typeof value === 'string') return value.startsWith('wrk_') ? value : null
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findWorkspaceId(item)
      if (found) return found
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      const found = findWorkspaceId(item)
      if (found) return found
    }
  }
  return null
}

function parseWorkspaceResponse(body) {
  const textId = firstMatch(/id\s*:\s*"(wrk_[^"]+)"/, body)
  if (textId) return textId
  try {
    return findWorkspaceId(JSON.parse(body))
  } catch {
    return null
  }
}

function parseZenResponse(body) {
  try {
    const value = findValue(JSON.parse(body), 'balance')
    return value === null ? null : Number(value) / 100000000
  } catch {
    const raw = firstMatch(/(?:"balance"|balance)\s*:\s*(?:\$R\[\d+\]\s*=\s*)?(-?[0-9]+(?:\.[0-9]+)?)/, body)
    return raw === null ? null : Number(raw) / 100000000
  }
}

function findValue(value, wantedKey) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findValue(item, wantedKey)
      if (found !== null) return found
    }
  }
  if (value && typeof value === 'object') {
    if (Object.hasOwn(value, wantedKey)) {
      const number = Number(value[wantedKey])
      return Number.isFinite(number) ? number : null
    }
    for (const item of Object.values(value)) {
      const found = findValue(item, wantedKey)
      if (found !== null) return found
    }
  }
  return null
}

function requestText(endpoint, cookie, timeoutMs = DEFAULT_TIMEOUT_MS, headers = {}) {
  const url = new URL(endpoint)
  const transport = url.protocol === 'https:' ? https : http
  const serverId = url.searchParams.get('id')
  return new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      timeout: timeoutMs,
      headers: {
        Accept: 'text/javascript, application/json;q=0.9, text/html;q=0.8, */*;q=0.8',
        Cookie: cookie,
        Origin: url.origin,
        Referer: url.origin,
        'User-Agent': USER_AGENT,
        ...(serverId ? {
          'X-Server-Id': serverId,
          'X-Server-Instance': `server-fn:${crypto.randomUUID()}`,
        } : {}),
        ...headers,
      },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const error = new Error(`OpenCode Go returned HTTP ${response.statusCode}`)
          error.code = response.statusCode === 401 || response.statusCode === 403 ? 'unauthorized' : 'http'
          reject(error)
          return
        }
        resolve(body)
      })
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('OpenCode Go request timed out')))
    request.on('error', reject)
    request.end()
  })
}

async function fetchOpenCodeGo(config, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!config?.configured) return { state: 'unconfigured', missing: config?.missing || ['configuration'] }
  const cookie = filterCookie(config.cookie)
  if (!cookie) return { state: 'unauthorized', reason: 'configured cookie has no auth value' }
  try {
    const base = config.baseUrl.replace(/\/$/, '')
    const workspaceResponse = await requestText(
      `${base}/_server?id=${WORKSPACES_SERVER_ID}`,
      cookie,
      timeoutMs,
    )
    const workspaceId = parseWorkspaceResponse(workspaceResponse)
    if (!workspaceId) throw new Error('OpenCode Go did not return a workspace')
    const usagePage = await requestText(`${base}/workspace/${encodeURIComponent(workspaceId)}/go`, cookie, timeoutMs)
    const snapshot = parseUsagePage(usagePage)
    try {
      const zenResponse = await requestText(
        `${base}/_server?id=${BILLING_SERVER_ID}&args=${encodeURIComponent(JSON.stringify([workspaceId]))}`,
        cookie,
        timeoutMs,
      )
      const zen = parseZenResponse(zenResponse)
      if (zen !== null && Number.isFinite(zen)) snapshot.zen = zen.toFixed(2)
    } catch {
      // Zen is optional; usage remains useful when billing data is unavailable.
    }
    return { state: 'available', snapshot: { ...snapshot, fetchedAt: new Date().toISOString() } }
  } catch (error) {
    return {
      state: error.code === 'unauthorized' ? 'unauthorized' : 'unavailable',
      reason: error.message,
    }
  }
}

module.exports = {
  BILLING_SERVER_ID,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  WORKSPACES_SERVER_ID,
  fetchOpenCodeGo,
  filterCookie,
  parseUsagePage,
  resolveOpenCodeGoConfig,
}
