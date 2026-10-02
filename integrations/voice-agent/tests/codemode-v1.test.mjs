import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { agentOptions, createResourceLoader, codingInstructions, personalInstructions } from '../src/agent.mjs'
import { assistant, offlineSession } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

// Unknown-property guards changed in Pi 1.0. Use the actual VM/pipeline instead
// of a JavaScript object mock, and distinguish failure from callable reach.
test('v1 discovery and typo recovery do not replay earlier completed calls', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'codemode-v1-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const calls = []
  const capability = defineTool({ name: 'desk_fixture', label: 'Fixture', description: 'A reviewed fixture capability',
    parameters: Type.Object({}), outputSchema: Type.Object({ ok: Type.Boolean() }),
    execute: async () => { calls.push('called'); return { content: [], details: undefined, structuredContent: { ok: true } } } })
  const resourceLoader = await createResourceLoader(dir, join(dir, 'agent'))
  const { session } = await offlineSession({ ...agentOptions(dir, dir, [capability]), resourceLoader }, (_context, count) =>
    count === 1 ? assistant([{ type: 'toolCall', id: 'v1-probe', name: 'codemode', arguments: { code:
      'text({known:"desk_fixture" in tools,excluded:"bash" in tools}); await tools.desk_fixture({}); try {tools.desk_fixtur;} catch(e){text({typoCaught:true,error:e.message});} text(await describeTool("desk_fixture"));' } }], 'toolUse') : assistant('fixture done'))
  t.after(() => session.dispose())
  await session.prompt('probe')
  const result = session.messages.find(message => message.role === 'toolResult')
  assert.equal(result.isError, false)
  const body = result.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
  assert.match(body, /"known":true/)
  assert.match(body, /"excluded":false/)
  assert.match(body, /"typoCaught":true/)
  assert.match(body, /tools\.desk_fixtur\b/)
  assert.match(body, /[Dd]id you mean[^\n]*desk_fixture/)
  assert.deepEqual(calls, ['called'])
  assert.equal(result.nestedCalls.calls.length, 1)
})

test('both coordinator profiles teach membership and discovery for v1 guarded tools', () => {
  assert.match(codingInstructions, /"name" in tools/)
  assert.match(personalInstructions, /"名称" in tools/)
  assert.match(codingInstructions, /never typeof tools.name/)
})
