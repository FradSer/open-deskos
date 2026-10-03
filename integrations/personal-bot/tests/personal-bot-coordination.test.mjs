import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createAgentSession, SessionManager, SettingsManager, defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { agentOptions, createResourceLoader } from '../src/agent.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

const repository = fileURLToPath(new URL('../../..', import.meta.url))

test('workspace and user settings cannot re-add generic mutation tools', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'personal-bot-coordination-settings-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  // A checkout is untrusted content an operator may have cloned, so a project or
  // global settings file naming bash/edit/write must not become a way back in.
  await mkdir(join(dir, '.pi'), { recursive: true })
  await mkdir(join(dir, 'agent'), { recursive: true })
  for (const [path, settings] of [
    [join(dir, '.pi', 'settings.json'), { defaultTools: ['read', 'bash', 'edit', 'write', 'powershell'] }],
    [join(dir, 'agent', 'settings.json'), { defaultTools: ['+bash', '+edit'] }],
  ]) await writeFile(path, JSON.stringify(settings))
  const loader = await createResourceLoader(dir, join(dir, 'agent'))
  const options = agentOptions(dir, dir, [])
  const { session } = await createAgentSession({ ...options, agentDir: join(dir, 'agent'),
    resourceLoader: loader, settingsManager: options.settingsManager,
    modelRuntime: { getAvailable: async () => [], getAvailableSnapshot: () => [], getModel: () => undefined,
      getError: () => undefined, getAuth: async () => undefined } })
  t.after(() => session.dispose())
  assert.deepEqual(session.getActiveToolNames().sort(), ['codemode', 'find', 'grep', 'ls', 'read'])
  assert.deepEqual(session.getAllTools().map(tool => tool.name).sort(), ['codemode', 'find', 'grep', 'ls', 'read'])
  assert.ok(!session.getCallableToolNames().some(name => ['bash', 'edit', 'write', 'powershell'].includes(name)))
})

test('resuming the coordinator does not restore generic mutation tools', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'personal-bot-coordination-')))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await isolateAgentDirectory(t, dir)
  const saved = SessionManager.create(repository, join(dir, 'sessions'))
  saved.appendMessage({ role: 'user', content: 'Earlier coding request', timestamp: 1 })
  saved.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Earlier direct implementation' }],
    api: 'test', provider: 'test', model: 'test', timestamp: 2, stopReason: 'stop',
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } })
  const inspected = defineTool({ name: 'desk_fixture', label: 'Fixture', description: 'A reviewed system capability',
    parameters: Type.Object({}), execute: async () => ({ content: [], details: {} }) })
  const resourceLoader = await createResourceLoader(repository, dir)
  const options = agentOptions(repository, dir, [inspected])
  const { session } = await createAgentSession({ ...options, agentDir: dir, resourceLoader,
    settingsManager: SettingsManager.inMemory({ defaultTools: options.settingsManager.getDefaultTools() }),
    modelRuntime: { getAvailable: async () => [], getAvailableSnapshot: () => [], getModel: () => undefined, getError: () => undefined, getAuth: async () => undefined } })
  t.after(() => session.dispose())
  assert.ok(session.messages.some(message => message.role === 'assistant'), 'fixture must resume earlier conversation')
  const active = ['codemode', 'find', 'grep', 'ls', 'read']
  assert.deepEqual(session.getActiveToolNames().sort(), active)
  assert.deepEqual(session.getAllTools().map(tool => tool.name).sort(), ['codemode', 'desk_fixture', 'find', 'grep', 'ls', 'read'])
  assert.deepEqual(session.getCallableToolNames().sort(), ['desk_fixture', 'find', 'grep', 'ls', 'read'])
  session.setActiveToolsByName(['bash', 'powershell', 'write', 'edit', ...active])
  assert.deepEqual(session.getActiveToolNames().sort(), active)
  assert.ok(!session.systemPrompt.includes('Use real read/write/edit/bash tools'))
})
