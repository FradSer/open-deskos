import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DEFAULT_PROACTIVE_POLL_MS, defaultProactiveConfig, resolveProactiveConfig } from '../src/recommendations/index.mjs'
import { validateOwnerConfig } from '../src/recommendations/index.mjs'

const source = name => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8')

test('the default owner configuration is valid and uses a 30-minute heartbeat', () => {
  assert.equal(DEFAULT_PROACTIVE_POLL_MS, 30 * 60 * 1000)
  const config = defaultProactiveConfig()
  assert.equal(config.pollMs, DEFAULT_PROACTIVE_POLL_MS)
  assert.deepEqual(config.rules, [])
  assert.deepEqual(validateOwnerConfig(config), { ...config, routineDays: {} })
})

test('no owner file selects the default configuration and refuses owner suppression writes', async () => {
  let loads = 0
  const resolved = resolveProactiveConfig({ env: {}, loadConfig: () => { loads++; return defaultProactiveConfig() } })
  assert.equal(resolved.config.pollMs, DEFAULT_PROACTIVE_POLL_MS)
  assert.equal(loads, 0)
  await assert.rejects(resolved.save({}), /No owner rule file selected/)
})

test('an explicit owner file keeps its heartbeat and its atomic suppression writer', async () => {
  const written = []
  const configured = { ...defaultProactiveConfig(), pollMs: 60000 }
  let loads = 0
  const resolved = resolveProactiveConfig({
    env: { ODK_PROACTIVE_CONFIG: '/private/owner.json' },
    loadConfig: file => { loads++; assert.equal(file, '/private/owner.json'); return configured },
    createWriter: (file, config) => (next, ...rest) => { written.push({ file, config, next, rest }); return config },
  })
  assert.equal(resolved.config.pollMs, 60000)
  assert.equal(loads, 1)
  assert.equal(await resolved.save({ ...configured, suppressed: ['topic'] }), configured)
  assert.deepEqual(written.map(({ file, next }) => ({ file, suppressed: next.suppressed })),
    [{ file: '/private/owner.json', suppressed: ['topic'] }])
})

test('the resident registers the Watch unconditionally', async () => {
  const main = await source('main.mjs')
  assert.doesNotMatch(main, /proactiveEnabled|watchEnabled|intentSelected|ODK_PRIVATE_RECOMMENDATIONS_FILE/, 'no owner or classifier value gates startup')
  assert.equal((main.match(/createWatch\s*[:(]/g) ?? []).length, 2, 'inspection and live composition both register the Watch')
  assert.doesNotMatch(main, /createProactiveJudge|createJevJudge/, 'no judgment client is wired into the Watch')
  assert.match(main, /resolveProactiveConfig\(/, 'the default configuration comes from the startup policy')
})

test('proposal generation has no judgment stage', async () => {
  const agent = await source('agent.mjs')
  const generation = agent.slice(agent.indexOf('generateProposals:'))
  assert.doesNotMatch(generation.slice(0, 1800), /createProactiveJudge|createJevJudge|judgment\.request/)
  assert.match(generation.slice(0, 1800), /createProactiveInvestigationTools/)
})
