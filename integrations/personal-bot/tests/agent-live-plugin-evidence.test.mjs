import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pluginEvidenceMetadata, toolExecutionMetadata } from './helpers/agent-live-plugin-evidence.mjs'

test('plugin diagnostics retain validation facts without generated or receipt text', () => {
  const receipts = [{ id: 'tool-1', tool: 'agent_mcp_call', status: 'succeeded', text: 'private fixture result', truncated: false }]
  const value = { status: 'passed', summary: 'private generated summary', checks: [{ requirement: 'Read report and RESULT', scope: 'completion', status: 'passed', evidence: [{ id: 'tool-1', quote: 'private fixture result' }] }] }
  const result = pluginEvidenceMetadata({ receipts }, JSON.stringify(value))
  assert.equal(result.validation, 'valid')
  assert.equal(result.status, 'passed')
  assert.equal(result.checks[0].evidence[0].quoteMatches, true)
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(pluginEvidenceMetadata({ receipts }, '{').jsonValid, false)
  value.checks[0].evidence[0].quote = 'wrong private quote'
  const mismatch = pluginEvidenceMetadata({ receipts }, JSON.stringify(value))
  assert.equal(mismatch.validation, 'invalid')
  assert.equal(mismatch.failureCode, 'citation')
  assert(!JSON.stringify(mismatch).includes('private'))
})

test('plugin diagnostics preserve explicit uncertainty and unsupported lesson evidence', () => {
  const result = pluginEvidenceMetadata({ receipts: [] }, JSON.stringify({ status: 'needs_review', summary: 'private content', checks: [{ requirement: 'Read Skill', status: 'needs_review', evidence: [] }] }))
  assert.equal(result.status, 'needs_review')
  assert.equal(result.checks[0].skill, true)
  assert.equal(result.validation, 'valid')
  const lessons = pluginEvidenceMetadata({ receipts: [], existingExperience: [] }, JSON.stringify({ lessons: [{ title: 'private title', body: 'private body', evidence: [] }] }))
  assert.equal(lessons.kind, 'learning')
  assert.equal(lessons.validation, 'invalid')
  assert.equal(lessons.failureCode, 'citation')
  assert.equal(JSON.stringify(lessons).includes('private'), false)
})

test('malformed generated requirements cannot break diagnostic capture', () => {
  for (const requirement of [{ toString: null }, null, ['private content'], 2]) {
    const result = pluginEvidenceMetadata({ receipts: [] }, JSON.stringify({ status: 'passed', checks: [{ requirement }] }))
    assert.equal(result.validation, 'invalid')
    assert.equal(result.checks[0].skill, false)
    assert.equal(JSON.stringify(result).includes('private'), false)
  }
})

test('live tool diagnostics retain fixed identities and failure categories without code, arguments or error text', () => {
  const context = { messages: [
    { role: 'assistant', content: [{ type: 'toolCall', name: 'codemode', arguments: { code: 'const privateValue="private-marker"; text(await tools.agent_package_install({id:privateValue,revision:"private-revision"}));' } }] },
    { role: 'toolResult', toolName: 'codemode', isError: true, content: [{ type: 'text', text: 'Agent package candidate revision changed; private-marker' }] },
  ] }
  assert.deepEqual(toolExecutionMetadata(context), { tools: ['agent_package_install'], error: 'revision_changed' })
  assert(!JSON.stringify(toolExecutionMetadata(context)).includes('private'))
  for (const [text, category] of [
    ['Cannot read properties of undefined private-marker', 'code_entry'],
    ['Tool arguments do not match its declared schema private-marker', 'arguments'],
    ['Agent package operation is unavailable private-marker', 'unavailable'],
    ['private-marker', 'unknown'],
  ]) {
    context.messages[1].content[0].text = text
    assert.equal(toolExecutionMetadata(context).error, category)
  }
  context.messages[1].isError = false
  assert.equal(toolExecutionMetadata(context).error, undefined)
  assert.equal(toolExecutionMetadata({ messages: [] }), undefined)
})
