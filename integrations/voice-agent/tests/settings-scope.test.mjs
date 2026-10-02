import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVoiceAgent } from '../src/agent.mjs'
import { createHostedSession } from '../src/task-agent.mjs'
import { assistant, fixtureModel, offlineSession, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory, operatorSettingsBytes } from './helpers/agent-directory.mjs'

const repository = fileURLToPath(new URL('../../..', import.meta.url))

// Exercise production startup, not a loader and options wired independently by
// the test. SDK loader.reload() discards applyOverrides on a shared instance.
for (const profile of ['coding', 'personal']) {
  test(profile + ' production startup keeps codemode and its reviewed callable surface', async t => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'voice-settings-scope-')))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const agentDir = await isolateAgentDirectory(t, dir)
    const previousTargets = process.env.ODESK_TASK_TARGETS_FILE
    delete process.env.ODESK_TASK_TARGETS_FILE
    t.after(() => {
      if (previousTargets !== undefined) process.env.ODESK_TASK_TARGETS_FILE = previousTargets
    })
    const before = await operatorSettingsBytes(agentDir)
    let sdk
    const voice = await createVoiceAgent({
      stateDir: join(dir, 'state'), workspace: repository, capabilityPaths: [],
      personal: { profile, memoryFile: join(dir, 'MEMORY.json'), skillPaths: [] },
    }, {
      createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }),
      createSession: async options => {
        sdk = await offlineSession(options, () => assistant('fixture startup'))
        return { session: sdk.session }
      },
    })
    t.after(() => voice.close())
    const active = profile === 'personal' ? ['codemode'] : ['codemode', 'find', 'grep', 'ls', 'read']
    assert.deepEqual(sdk.session.getActiveToolNames().sort(), active)
    const callable = sdk.session.getCallableToolNames()
    for (const name of profile === 'personal' ? ['memory_read', 'memory_update', 'skill_read'] : ['desk_data', 'coding_targets', 'coding_task_start']) {
      assert.ok(callable.includes(name), name + ' must remain callable after the loader reloads')
    }
    for (const name of ['bash', 'powershell', 'edit', 'write']) assert.ok(!callable.includes(name))
    assert.equal(await voice.prompt('fixture startup'), 'fixture startup')
    for (const request of sdk.requests) assert.deepEqual(visibleTools(request).map(tool => tool.name), ['codemode'])
    assert.equal(await operatorSettingsBytes(agentDir), before, 'startup must not rewrite operator settings')
  })
}

for (const profile of ['coding', 'personal', 'hosted']) {
  test(profile + ' startup honors global cache warming without a persistent override', async t => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), 'voice-warming-scope-')))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const agentDir = await isolateAgentDirectory(t, dir, { cacheWarming: 'streaming' })
    const before = await operatorSettingsBytes(agentDir)
    let sdk
    const createSession = async options => {
      assert.equal(options.settingsManager.getCacheWarmingMode(), 'streaming')
      sdk = await offlineSession(options, () => assistant('no prompt in this test'))
      return { session: sdk.session }
    }
    if (profile === 'hosted') {
      const hosted = await createHostedSession({ task: { project: dir }, sessionDir: join(dir, 'logs') }, {
        createRuntime: async () => ({}), createSession,
      })
      hosted.dispose()
    } else {
      const previousTargets = process.env.ODESK_TASK_TARGETS_FILE
      delete process.env.ODESK_TASK_TARGETS_FILE
      t.after(() => { if (previousTargets !== undefined) process.env.ODESK_TASK_TARGETS_FILE = previousTargets })
      const voice = await createVoiceAgent({
        stateDir: join(dir, 'state'), workspace: repository, capabilityPaths: [],
        personal: { profile, memoryFile: join(dir, 'MEMORY.json'), skillPaths: [] },
      }, { createRuntime: async () => ({ getAvailable: async () => [fixtureModel] }), createSession })
      await voice.close()
    }
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(sdk)
    assert.equal(await operatorSettingsBytes(agentDir), before)
  })
}
