const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')

const DEFAULT_BASE_URL = 'http://127.0.0.1:8317'
const DEFAULT_TIMEOUT_MS = 10000
const MANAGEMENT_PATH = '/v0/management'
const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CODEX_RESET_CREDITS_URL = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits'
const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:retrieveUserQuotaSummary',
  'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
]
const XAI_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'
const XAI_SETTINGS_URL = 'https://cli-chat-proxy.grok.com/v1/settings'

function resolveOpenCodeGoConfig(env = process.env, fileSystem = fs) {
  const baseUrl = (env.ODK_CLIPROXY_URL || DEFAULT_BASE_URL).trim()
  const managementKey = env.ODK_CLIPROXY_MANAGEMENT_KEY?.trim()
    || readSecretFile(env.ODK_CLIPROXY_MANAGEMENT_KEY_FILE, fileSystem)
    || readDefaultManagementKey(env, fileSystem)
  const missing = []
  if (!secureManagementUrl(baseUrl)) missing.push('secure ODK_CLIPROXY_URL')
  if (!managementKey) missing.push('ODK_CLIPROXY_MANAGEMENT_KEY or ODK_CLIPROXY_MANAGEMENT_KEY_FILE')
  return {
    baseUrl: secureManagementUrl(baseUrl) ? baseUrl.replace(/\/$/, '') : null,
    managementKey: managementKey || null,
    configured: missing.length === 0,
    missing,
  }
}

function secureManagementUrl(value) {
  try {
    const url = new URL(value)
    const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname)
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback)
  } catch {
    return false
  }
}

function readSecretFile(filePath, fileSystem) {
  if (!filePath?.trim()) return ''
  try {
    return fileSystem.readFileSync(filePath.trim(), 'utf8').trim()
  } catch {
    return ''
  }
}

function readDefaultManagementKey(env, fileSystem) {
  const paths = [
    '/etc/open-deskos/cliproxy-management.key',
    env.HOME ? `${env.HOME}/.config/open-deskos/cliproxy-management.key` : null,
    env.HOME ? `${env.HOME}/.open-deskos/cliproxy-management.key` : null,
  ].filter(Boolean)
  for (const filePath of paths) {
    const key = readSecretFile(filePath, fileSystem)
    if (key) return key
  }
  return ''
}

function requestJson(endpoint, options = {}) {
  const url = new URL(endpoint)
  const transport = url.protocol === 'https:' ? https : http
  const body = options.body === undefined ? null : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      timeout: options.timeoutMs || DEFAULT_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...options.headers,
      },
    }, (response) => collectJsonResponse(response, resolve, reject))
    request.on('timeout', () => request.destroy(new Error('CLIProxyAPI request timed out')))
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

function collectJsonResponse(response, resolve, reject) {
  let body = ''
  response.setEncoding('utf8')
  response.on('data', (chunk) => { body += chunk })
  response.on('end', () => {
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const error = new Error(`CLIProxyAPI returned HTTP ${response.statusCode}`)
      error.code = [401, 403].includes(response.statusCode) ? 'unauthorized' : 'http'
      reject(error)
      return
    }
    try {
      resolve(body ? JSON.parse(body) : {})
    } catch {
      reject(new Error('CLIProxyAPI returned invalid JSON'))
    }
  })
  response.on('error', reject)
}

function managementRequest(config, path, options = {}) {
  return requestJson(`${config.baseUrl}${MANAGEMENT_PATH}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${config.managementKey}`, ...options.headers },
  })
}

function authFilesFromResponse(response) {
  const files = response?.authfiles || response?.files || response?.auth_files || response?.data || response
  return Array.isArray(files) ? files : []
}

function providerType(auth) {
  const type = String(auth?.type || auth?.provider || '').toLowerCase()
  return type === 'grok' ? 'xai' : type
}

function enabledQuotaAuthFiles(response) {
  return authFilesFromResponse(response).filter((auth) => {
    return !auth.disabled && ['codex', 'antigravity', 'xai'].includes(providerType(auth))
  })
}

async function proxyProviderCall(config, auth, providerRequest) {
  const response = await managementRequest(config, '/api-call', {
    method: 'POST',
    body: { auth_index: auth.auth_index, ...providerRequest },
  })
  if (response.status_code < 200 || response.status_code >= 300) {
    throw new Error(`Provider returned HTTP ${response.status_code}`)
  }
  try {
    return JSON.parse(response.body || '{}')
  } catch {
    throw new Error('Provider returned invalid JSON')
  }
}

function baseCard(auth, provider) {
  return {
    id: auth.auth_index || auth.id || auth.name,
    provider,
    fileName: auth.name || 'Authentication file',
    account: auth.email || auth.label || null,
    plan: null,
    groups: [],
  }
}

function titleCase(value) {
  return String(value || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function boundedPercent(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null
}

function remainingPercentFromUsed(value) {
  const used = boundedPercent(value)
  return used === null ? null : Math.round((100 - used) * 10) / 10
}

function resetAt(window, now = new Date()) {
  if (window?.reset_at !== undefined && Number.isFinite(Number(window.reset_at))) {
    return new Date(Number(window.reset_at) * 1000).toISOString()
  }
  if (window?.reset_after_seconds !== undefined && Number.isFinite(Number(window.reset_after_seconds))) {
    return new Date(now.getTime() + Number(window.reset_after_seconds) * 1000).toISOString()
  }
  return null
}

function codexWindow(label, window, now) {
  if (!window) return null
  const remainingPct = remainingPercentFromUsed(window.used_percent)
  if (remainingPct === null) return null
  return {
    label,
    remainingPct,
    resetAt: resetAt(window, now),
    description: null,
  }
}

function codexLimitsGroup(rateLimit, now) {
  const quotas = [
    codexWindow('5 hour limit', rateLimit?.primary_window, now),
    codexWindow('Weekly limit', rateLimit?.secondary_window, now),
  ].filter(Boolean)
  return quotas.length ? { title: 'Codex limits', description: null, quotas } : null
}

function codexAdditionalGroups(limits, now) {
  return (Array.isArray(limits) ? limits : []).map((limit) => {
    const name = limit.limit_name || 'Additional limit'
    const quotas = [
      codexWindow(`${name} · 5 hours`, limit.rate_limit?.primary_window, now),
      codexWindow(`${name} · weekly`, limit.rate_limit?.secondary_window, now),
    ].filter(Boolean)
    return quotas.length ? { title: name, description: null, quotas } : null
  }).filter(Boolean)
}

function normalizeCodexQuota(auth, usage, resetCredits = {}, now = new Date()) {
  const card = baseCard(auth, 'codex')
  card.plan = titleCase(usage?.plan_type || auth.account_type || 'Codex')
  card.groups = [codexLimitsGroup(usage?.rate_limit, now), ...codexAdditionalGroups(usage?.additional_rate_limits, now)].filter(Boolean)
  const availableCredits = Array.isArray(resetCredits.credits)
    ? resetCredits.credits.filter((credit) => credit.status === 'available')
    : []
  card.resetCredits = {
    available: Math.max(0, Number(resetCredits.available_count ?? usage?.rate_limit_reset_credits?.available_count) || 0),
    expiresAt: availableCredits.map((credit) => credit.expires_at).filter(Boolean),
  }
  if (!card.groups.length) throw new Error('Codex returned no usable quota windows')
  return card
}

function normalizedQuotaBucket(bucket) {
  const fraction = Number(bucket?.remainingFraction ?? bucket?.remaining_fraction)
  return {
    label: bucket?.displayName || bucket?.display_name || bucket?.window || 'Quota',
    remainingPct: Number.isFinite(fraction) ? boundedPercent(fraction * 100) : null,
    resetAt: bucket?.resetTime || bucket?.reset_time || null,
    description: bucket?.description || null,
  }
}

function quotaGroups(response) {
  return (Array.isArray(response?.groups) ? response.groups : []).map((group) => ({
    title: group.displayName || group.display_name || 'Model limits',
    description: group.description || null,
    quotas: (Array.isArray(group.buckets) ? group.buckets : []).map(normalizedQuotaBucket).filter((quota) => quota.remainingPct !== null),
  })).filter((group) => group.quotas.length)
}

function normalizeAntigravityQuota(auth, response) {
  const card = baseCard(auth, 'antigravity')
  card.plan = response?.subscription?.plan || response?.subscription?.tierName || 'Antigravity'
  card.groups = quotaGroups(response)
  if (!card.groups.length) throw new Error('Antigravity returned no usable quota windows')
  return card
}

function normalizeXaiQuota(auth, billing, settings = {}) {
  const card = baseCard(auth, 'xai')
  const used = billing?.config?.creditUsagePercent
  const fallbackUsed = Number(billing?.config?.onDemandUsed?.val ?? billing?.onDemandUsed?.val)
  const fallbackCap = Number(billing?.config?.onDemandCap?.val ?? billing?.onDemandCap?.val)
  const usedPct = used ?? (fallbackCap > 0 ? (fallbackUsed / fallbackCap) * 100 : null)
  card.plan = settings.subscription_tier_display || billing?.config?.subscriptionTierDisplay || 'xAI'
  const periodEnd = billing?.config?.currentPeriod?.end || billing?.config?.billingPeriodEnd || null
  if (boundedPercent(usedPct) === null && !periodEnd) throw new Error('xAI returned no usable quota data')
  card.groups = [{
    title: 'Grok limits',
    description: null,
    quotas: [{
      label: 'Billing period',
      remainingPct: remainingPercentFromUsed(usedPct),
      resetAt: periodEnd,
      description: null,
    }],
  }]
  return card
}

function findAccountId(value) {
  if (typeof value === 'string' && value.startsWith('acct_')) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAccountId(item)
      if (found) return found
    }
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (key === 'chatgpt_account_id' && typeof item === 'string') return item
      const found = findAccountId(item)
      if (found) return found
    }
  }
  return null
}

async function fetchCodexCard(config, auth) {
  const headers = {
    Authorization: 'Bearer $TOKEN$',
    Accept: 'application/json',
    ...(findAccountId(auth) ? { 'ChatGPT-Account-Id': findAccountId(auth) } : {}),
  }
  const usage = await proxyProviderCall(config, auth, { method: 'GET', url: CODEX_USAGE_URL, header: headers })
  let resetCredits = {}
  try {
    resetCredits = await proxyProviderCall(config, auth, { method: 'GET', url: CODEX_RESET_CREDITS_URL, header: headers })
  } catch {
    // The rate-limit windows remain useful when reset-credit details are unavailable.
  }
  return normalizeCodexQuota(auth, usage, resetCredits)
}

async function fetchAntigravityCard(config, auth) {
  let lastError
  for (const url of ANTIGRAVITY_QUOTA_URLS) {
    try {
      const response = await proxyProviderCall(config, auth, {
        method: 'POST',
        url,
        header: {
          Authorization: 'Bearer $TOKEN$',
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity/cli/1.0.13 (aidev_client; os_type=linux; arch=arm64)',
        },
        data: JSON.stringify({ project: auth.project_id }),
      })
      return normalizeAntigravityQuota(auth, response)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}

async function fetchXaiCard(config, auth) {
  const header = { Authorization: 'Bearer $TOKEN$', 'x-xai-token-auth': 'xai-grok-cli', Accept: 'application/json' }
  const billing = await proxyProviderCall(config, auth, { method: 'GET', url: XAI_BILLING_URL, header })
  let settings = {}
  try {
    settings = await proxyProviderCall(config, auth, { method: 'GET', url: XAI_SETTINGS_URL, header })
  } catch {
    // Billing data remains truthful without the optional plan display name.
  }
  return normalizeXaiQuota(auth, billing, settings)
}

async function fetchQuotaCard(config, auth) {
  const type = providerType(auth)
  if (type === 'codex') return fetchCodexCard(config, auth)
  if (type === 'antigravity') return fetchAntigravityCard(config, auth)
  return fetchXaiCard(config, auth)
}

async function fetchOpenCodeGo(config) {
  if (!config?.configured) return { state: 'unconfigured', missing: config?.missing || ['configuration'] }
  try {
    const response = await managementRequest(config, '/auth-files')
    const authFiles = enabledQuotaAuthFiles(response)
    const results = await Promise.allSettled(authFiles.map((auth) => fetchQuotaCard(config, auth)))
    const accounts = results.map((result, index) => result.status === 'fulfilled'
      ? result.value
      : { ...baseCard(authFiles[index], providerType(authFiles[index])), error: result.reason.message })
    return {
      state: accounts.some((account) => !account.error) ? 'available' : 'unavailable',
      snapshot: { accounts, fetchedAt: new Date().toISOString() },
      reason: accounts.length === 0 ? 'CLIProxyAPI has no enabled quota authentication files' : undefined,
    }
  } catch (error) {
    return { state: error.code === 'unauthorized' ? 'unauthorized' : 'unavailable', reason: error.message }
  }
}

module.exports = {
  ANTIGRAVITY_QUOTA_URLS,
  CODEX_RESET_CREDITS_URL,
  CODEX_USAGE_URL,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  XAI_BILLING_URL,
  XAI_SETTINGS_URL,
  fetchOpenCodeGo,
  normalizeAntigravityQuota,
  normalizeCodexQuota,
  normalizeXaiQuota,
  resolveOpenCodeGoConfig,
}
