const test = require('node:test')
const assert = require('node:assert/strict')
const {
  filterCookie,
  parseUsagePage,
  resolveOpenCodeGoConfig,
} = require('../src/opencode-go')

test('requires an explicit OpenCode Go cookie without exposing it in config status', () => {
  const missing = resolveOpenCodeGoConfig({})
  assert.equal(missing.configured, false)
  assert.deepEqual(missing.missing, [
    'ODK_OPENCODE_COOKIE or ODK_OPENCODE_COOKIE_FILE',
  ])
  const configured = resolveOpenCodeGoConfig({
    ODK_OPENCODE_GO_URL: 'https://opencode.ai',
    ODK_OPENCODE_COOKIE: 'auth=session-value',
  })
  assert.equal(configured.configured, true)
  assert.equal(configured.baseUrl, 'https://opencode.ai')
  assert.equal(configured.cookie, 'auth=session-value')
})

test('supports a configurable HTTPS endpoint and filters unrelated cookies', () => {
  const config = resolveOpenCodeGoConfig({
    ODK_OPENCODE_GO_URL: 'https://usage.example',
    ODK_OPENCODE_COOKIE: 'auth=session; tracking=noise; __Host-auth=host-session',
  })
  assert.equal(config.configured, true)
  assert.equal(config.baseUrl, 'https://usage.example')
  assert.equal(filterCookie(config.cookie), 'auth=session; __Host-auth=host-session')
})

test('rejects invalid endpoint protocols', () => {
  const config = resolveOpenCodeGoConfig({
    ODK_OPENCODE_GO_URL: 'file:///tmp/status',
    ODK_OPENCODE_COOKIE: 'auth=session-value',
  })
  assert.equal(config.configured, false)
  assert.ok(config.missing.includes('valid ODK_OPENCODE_GO_URL'))
})

test('parses rolling, weekly, monthly usage and reset fields', () => {
  const snapshot = parseUsagePage(`
    rollingUsage: { usagePercent: 62, resetInSec: 1110 },
    weeklyUsage: { usagePercent: 41 },
    monthlyUsage: { usagePercent: 77 },
  `)
  assert.deepEqual(snapshot, {
    plan: 'opencode-go',
    rollingPct: 62,
    rollingResetMin: 18,
    weekPct: 41,
    monthPct: 77,
  })
})

test('rejects usage pages without a rolling window', () => {
  assert.throws(() => parseUsagePage('{}'), /no rolling usage/)
  assert.throws(() => parseUsagePage('rollingUsage: { usagePercent: 140 }'), /no rolling usage/)
})
