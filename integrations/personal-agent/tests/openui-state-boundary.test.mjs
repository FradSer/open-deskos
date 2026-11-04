// The service and the Shell frame must agree on what a renderable OpenUI tree is.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, realpathSync, mkdirSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { proposalStateStore } from '../src/proactive-state.mjs'

const store = t => {
  const outer = mkdtempSync(join(tmpdir(), 'odk-ui-state-'))
  const dir = join(outer, 'private')
  mkdirSync(dir, { mode: 0o700 })
  chmodSync(dir, 0o700)
  t.after(() => rmSync(outer, { recursive: true, force: true }))
  return proposalStateStore(join(realpathSync(dir), 'state.json'))
}

const proposal = ui => ({ id: '11111111-1111-4111-8111-111111111111', ruleId: 'topic', subject: 'topic:key',
  ruleVersion: 'v1', status: 'pending', advice: '通勤比平时多了28分钟。', confirmation: '',
  result: '', nextStep: '查看通勤安排', offered: true, presented: true, action: null,
  ui, evidence: [], createdAt: new Date().toISOString() })

const validTree = { type: 'Suggestions', children: [
  { type: 'Suggestion', children: [
    { type: 'Heading', props: { value: '通勤状态' } },
    { type: 'Stack', children: [{ type: 'Metric', props: { label: '用时', value: '52 分钟' } }] },
  ] },
] }

test('a bounded OpenUI tree survives the private state round trip', t => {
  const s = store(t)
  s.save({ version: 1, proposals: [proposal(validTree)] })
  assert.deepEqual(s.load().proposals[0].ui, validTree)
})

test('malformed OpenUI trees are refused by the service, not just the Shell frame', t => {
  const s = store(t)
  for (const bad of [
    { type: '', children: [] },
    { type: 'Suggestions', children: 'nope' },
    { type: 'Suggestions', children: [{ nope: 1 }] },
    { type: 'Suggestions', props: 'bad', children: [] },
  ]) assert.throws(() => s.save({ version: 1, proposals: [proposal(bad)] }), /Invalid proposal OpenUI tree/, JSON.stringify(bad))
})
