import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostedSession, readHostedHistory } from '../src/task-agent.mjs'
import { assistant, offlineSession, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

test('a nested coding check stays in persisted history even when the script omits its output', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'hosted-codemode-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  let sdk
  const hosted = await createHostedSession({ task: { project: dir }, sessionDir: join(dir, 'logs') }, {
    createRuntime: async () => ({}),
    createSession: async options => {
      sdk = await offlineSession({ ...options, agentDir: join(dir, 'agent') }, (_context, count) => count === 1
        ? assistant([{ type: 'toolCall', id: 'worker-code', name: 'codemode', arguments: {
          code: 'const r=await tools.coding_check({command:"echo fixture-check"}); text("check output intentionally omitted");' } }], 'toolUse')
        : assistant('Turn ended; no independent verification'))
      return { session: sdk.session }
    },
  })
  t.after(() => hosted.dispose())
  assert.equal((await hosted.prompt('run the check')).stopReason, 'stop')
  const registered = sdk.session.getAllTools().map(tool => tool.name)
  const callable = sdk.session.getCallableToolNames()
  for (const name of ['read', 'write', 'edit', 'bash', 'codemode']) {
    assert.ok(sdk.session.getActiveToolNames().includes(name))
    assert.ok(registered.includes(name))
  }
  for (const name of ['read', 'write', 'edit', 'bash', 'coding_check']) assert.ok(callable.includes(name))
  assert.ok(sdk.requests.every(request => visibleTools(request).some(tool => tool.name === 'codemode')))
  const rawCheck = readHostedHistory(hosted.sessionFile).events.flatMap(batch => batch.events).find(event => event.toolName === 'coding_check')
  assert.ok(rawCheck, 'nested results are not persisted by Pi, so host must retain the observed evidence itself')
  const evidence = JSON.parse(rawCheck.text.split('\n\n')[0]).codingCheck
  assert.equal(evidence.exitCode, 0)
  assert.equal(evidence.sourceBinding, 'unavailable', 'a non-Git project must not invent a source candidate')
  assert.equal(evidence.toolCallId, 'worker-code/1')
})
