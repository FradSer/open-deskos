const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeAntigravityQuota,
  normalizeCodexQuota,
  normalizeXaiQuota,
  resolveOpenCodeGoConfig,
} = require('../src/opencode-go')

test('requires an explicit CLIProxyAPI management key without exposing it in config status', () => {
  const missing = resolveOpenCodeGoConfig({
    ODK_CLIPROXY_URL: '',
    ODK_CLIPROXY_MANAGEMENT_KEY: '',
    ODK_CLIPROXY_MANAGEMENT_KEY_FILE: '',
  }, { readFileSync() { throw new Error('no key file') } })
  assert.equal(missing.configured, false)
  assert.deepEqual(missing.missing, ['ODK_CLIPROXY_MANAGEMENT_KEY or ODK_CLIPROXY_MANAGEMENT_KEY_FILE'])

  const configured = resolveOpenCodeGoConfig({
    ODK_CLIPROXY_URL: 'https://cliproxy.example',
    ODK_CLIPROXY_MANAGEMENT_KEY: 'management-secret',
  })
  assert.equal(configured.configured, true)
  assert.equal(configured.baseUrl, 'https://cliproxy.example')
  assert.equal(configured.managementKey, 'management-secret')
})

test('rejects invalid protocols and plaintext remote CLIProxyAPI endpoints', () => {
  for (const url of ['file:///tmp/status', 'http://frad-nas:8317']) {
    const config = resolveOpenCodeGoConfig({
      ODK_CLIPROXY_URL: url,
      ODK_CLIPROXY_MANAGEMENT_KEY: 'management-secret',
    })
    assert.equal(config.configured, false)
    assert.ok(config.missing.includes('secure ODK_CLIPROXY_URL'))
  }
  assert.equal(resolveOpenCodeGoConfig({
    ODK_CLIPROXY_URL: 'http://127.0.0.1:8317',
    ODK_CLIPROXY_MANAGEMENT_KEY: 'management-secret',
  }).configured, true)
})

test('normalizes Codex primary, weekly, additional, and reset-credit quotas', () => {
  const card = normalizeCodexQuota({ name: 'codex-personal.json', email: 'user@example.com' }, {
    plan_type: 'pro',
    rate_limit: {
      primary_window: { used_percent: 12, limit_window_seconds: 18000, reset_at: 1_800_000_000 },
      secondary_window: { used_percent: 35, limit_window_seconds: 604800, reset_after_seconds: 7200 },
    },
    additional_rate_limits: [{
      limit_name: 'GPT-5.3-Codex-Spark',
      rate_limit: { primary_window: { used_percent: 4, limit_window_seconds: 18000 } },
    }],
  }, {
    available_count: 2,
    credits: [{ status: 'available', expires_at: '2027-01-01T00:00:00Z' }],
  }, new Date('2026-01-01T00:00:00Z'))

  assert.equal(card.plan, 'Pro')
  assert.equal(card.resetCredits.available, 2)
  assert.equal(card.groups[0].quotas[0].remainingPct, 88)
  assert.equal(card.groups[0].quotas[1].remainingPct, 65)
  assert.equal(card.groups[1].quotas[0].label, 'GPT-5.3-Codex-Spark · 5 hours')
})

test('normalizes Antigravity grouped quota responses', () => {
  const card = normalizeAntigravityQuota({ name: 'antigravity-user.json', email: 'user@example.com' }, {
    subscription: { plan: 'Pro' },
    groups: [{
      displayName: 'Gemini models',
      description: 'Models within this group: Gemini Flash, Gemini Pro',
      buckets: [{ displayName: 'Five Hour Limit Remaining', window: '5h', remainingFraction: 0.8, resetTime: '2027-01-01T00:00:00Z' }],
    }],
  })
  assert.equal(card.plan, 'Pro')
  assert.deepEqual(card.groups[0].quotas[0], {
    label: 'Five Hour Limit Remaining',
    remainingPct: 80,
    resetAt: '2027-01-01T00:00:00Z',
    description: null,
  })
})

test('rejects empty or null provider quota payloads instead of fabricating quota', () => {
  assert.throws(() => normalizeCodexQuota({ name: 'codex.json' }, { rate_limit: { primary_window: { used_percent: null } } }), /no usable quota/)
  assert.throws(() => normalizeAntigravityQuota({ name: 'antigravity.json' }, {}), /no usable quota/)
  assert.throws(() => normalizeXaiQuota({ name: 'xai.json' }, {}, {}), /no usable quota/)
})

test('normalizes xAI billing percentages and plan names', () => {
  const card = normalizeXaiQuota({ name: 'xai-user.json', email: 'user@example.com' }, {
    config: { creditUsagePercent: 23, currentPeriod: { end: '2027-02-01T00:00:00Z' } },
  }, { subscription_tier_display: 'SuperGrok' })
  assert.equal(card.plan, 'SuperGrok')
  assert.equal(card.groups[0].quotas[0].remainingPct, 77)
  assert.equal(card.groups[0].quotas[0].resetAt, '2027-02-01T00:00:00Z')
})

test('keeps a truthful unknown xAI percentage when a zero-cap period has a reset date', () => {
  const card = normalizeXaiQuota({ name: 'xai-user.json' }, {
    config: {
      currentPeriod: { end: '2027-02-01T00:00:00Z' },
      onDemandUsed: { val: 0 },
      onDemandCap: { val: 0 },
    },
  })
  assert.equal(card.groups[0].quotas[0].remainingPct, null)
  assert.equal(card.groups[0].quotas[0].resetAt, '2027-02-01T00:00:00Z')
})

test('normalizes current xAI nested on-demand billing values', () => {
  const card = normalizeXaiQuota({ name: 'xai-user.json' }, {
    config: {
      currentPeriod: { end: '2027-02-01T00:00:00Z' },
      onDemandUsed: { val: 25 },
      onDemandCap: { val: 100 },
    },
  })
  assert.equal(card.groups[0].quotas[0].remainingPct, 75)
})
