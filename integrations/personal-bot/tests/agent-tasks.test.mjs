import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, readFile, writeFile, symlink, link } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openAgentTasks } from '../src/agent-tasks/runtime.mjs'
import { createAgentTaskTools } from '../src/agent-tasks/tools.mjs'
import { protectProactivePath } from '../src/proactive-private.mjs'

async function fixture(t, createWorker) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-tasks-')))
  const directory = join(root, 'tasks')
  const runtime = await openAgentTasks({ directory, createWorker })
  t.after(async () => { try { await runtime.close() } finally { await rm(root, { recursive: true, force: true }) } })
  return { root, directory, runtime }
}
const identity = { id: 'researcher', name: 'Researcher', role: 'Read actual sources and cite evidence.', avatar: 'book' }
const worker = answer => ({ prompt: async () => answer, abort: async () => {}, close: async () => {} })

test('temporary task admission is asynchronous and isolated, with verification separate from its answer', async t => {
  const started = Promise.withResolvers(), finish = Promise.withResolvers()
  let spec, closed = 0
  const { runtime } = await fixture(t, async value => { spec = value; return {
    ...worker(''), prompt: () => { started.resolve(); return finish.promise }, abort: async () => finish.resolve('cancelled'), close: async () => { closed++ },
  } })
  const admitted = runtime.start({ request: 'Compare the supplied measurements.', role: 'Find arithmetic mistakes.' })
  assert.equal(admitted.state, 'starting')
  await started.promise
  assert.equal(runtime.status(admitted.taskId).state, 'running')
  assert.equal(spec.request, 'Compare the supplied measurements.')
  assert.equal(spec.role, 'Find arithmetic mistakes.')
  assert.match(spec.home, new RegExp(admitted.taskId))
  assert(!('history' in spec))
  finish.resolve('The second measurement is larger.')
  const result = await runtime.wait(admitted.taskId)
  assert.equal(result.state, 'finished')
  assert.equal(result.response, 'The second measurement is larger.')
  assert.equal(result.verification.status, 'not_run')
  assert.equal(closed, 1)
})

test('unsupported worker learning status requires review without poisoning later tasks or restart', async t => {
  const { runtime, directory } = await fixture(t, async () => ({ ...worker('Observed fixture answer.'),
    lastTaskResult: { verification: { status: 'passed', summary: 'Fixture evidence checked.' }, learning: { status: 'recorded' } },
  }))
  const first = runtime.start({ request: 'Check the fixture.' })
  const result = await runtime.wait(first.taskId)
  assert.equal(result.state, 'finished')
  assert.equal(result.learning, 'needs_review')
  const later = runtime.start({ request: 'Check another fixture.' })
  assert.equal((await runtime.wait(later.taskId)).state, 'finished')
  runtime.saveIdentity(identity)
  await runtime.close()
  const restarted = await openAgentTasks({ directory, createWorker: async () => worker('No replay expected.') })
  try {
    assert.equal(restarted.status(first.taskId).learning, 'needs_review')
    assert.equal(restarted.status(first.taskId).response, 'Observed fixture answer.')
    assert.equal(restarted.status(later.taskId).state, 'finished')
    assert.equal(restarted.identities()[0].id, identity.id)
  } finally { await restarted.close() }
})

test('saved identities retain homes and avatars across restart without leaking between identities', async t => {
  const homes = []
  const { runtime, directory } = await fixture(t, async spec => { homes.push(spec); return worker('Read result.') })
  const saved = runtime.saveIdentity(identity)
  assert.match(saved.revision, /^[a-f0-9]{64}$/)
  const first = runtime.start({ identityId: identity.id, request: 'Read report one.' })
  assert.deepEqual(first.identity, { id: identity.id, name: identity.name, avatar: identity.avatar, revision: saved.revision })
  await runtime.wait(first.taskId)
  await runtime.close()
  const next = await openAgentTasks({ directory, createWorker: async spec => { homes.push(spec); return worker('Next result.') } })
  t.after(() => next.close())
  const second = next.start({ identityId: identity.id, request: 'Read report two.' })
  await next.wait(second.taskId)
  next.saveIdentity({ ...identity, id: 'checker', name: 'Checker', avatar: 'code' })
  const third = next.start({ identityId: 'checker', request: 'Check report.' })
  await next.wait(third.taskId)
  assert.equal(homes[0].home, homes[1].home)
  assert.notEqual(homes[1].home, homes[2].home)
  assert.equal(homes[1].role, identity.role)
  assert.equal(next.identities().length, 2)
  await next.close()
})

test('exact saved revision, bounded concurrency, and single-identity ownership precede dispatch', async t => {
  const finish = Promise.withResolvers()
  let calls = 0
  const { runtime } = await fixture(t, async () => { calls++; return { ...worker(''), prompt: () => finish.promise } })
  runtime.saveIdentity(identity)
  const task = runtime.start({ identityId: identity.id, request: 'Inspect report.' })
  assert.throws(() => runtime.start({ identityId: identity.id, request: 'Overlap report.' }), /already.*active/i)
  assert.throws(() => runtime.saveIdentity({ ...identity, role: 'Changed role.' }), /revision/i)
  assert.throws(() => runtime.saveIdentity({ ...identity, role: 'Changed role.', expectedRevision: '0'.repeat(64) }), /revision/i)
  assert.throws(() => runtime.start({ identityId: identity.id, request: 'Override role.', role: 'Different role.' }), /role|identity/i)
  assert.throws(() => runtime.start({ request: 'x', role: '../escape' , extra: true }), /invalid/i)
  finish.resolve('Done.')
  await runtime.wait(task.taskId)
  assert.equal(calls, 1)
})

test('cancellation during worker creation fences late answers and closes the late worker exactly once', async t => {
  const started = Promise.withResolvers(), create = Promise.withResolvers()
  let prompts = 0, closed = 0
  const { runtime } = await fixture(t, async spec => { started.resolve(spec); return create.promise })
  const task = runtime.start({ request: 'A slow task.' })
  const spec = await started.promise
  assert.equal(runtime.cancel(task.taskId).state, 'cancelling')
  assert.equal(spec.signal.aborted, true)
  create.resolve({ ...worker('late'), prompt: async () => { prompts++; return 'late' }, close: async () => { closed++ } })
  const result = await runtime.wait(task.taskId)
  assert.equal(result.state, 'cancelled')
  assert.equal(result.response, '')
  assert.equal(result.verification.status, 'needs_review')
  assert.equal(prompts, 0)
  assert.equal(closed, 1)
})

test('cancellation of a running task fences a provider that resolves after abort', async t => {
  const started = Promise.withResolvers(), finish = Promise.withResolvers()
  let aborts = 0
  const { runtime } = await fixture(t, async () => ({ ...worker(''), prompt: () => { started.resolve(); return finish.promise }, abort: async () => { aborts++; finish.resolve('late success') } }))
  const task = runtime.start({ request: 'Do not replay this operation.' })
  await started.promise
  runtime.cancel(task.taskId)
  assert.equal((await runtime.wait(task.taskId)).state, 'cancelled')
  assert.equal(runtime.status(task.taskId).response, '')
  assert.equal(aborts, 1)
})

test('a restarted task registry marks inflight records interrupted without dispatching work', async t => {
  const { runtime, directory } = await fixture(t, async () => worker('Complete result.'))
  const task = runtime.start({ request: 'Read report.' })
  await runtime.wait(task.taskId)
  await runtime.close()
  const file = join(directory, 'state.json')
  const state = JSON.parse(await readFile(file, 'utf8'))
  state.tasks[0].state = 'running'
  await writeFile(file, JSON.stringify(state), { mode: 0o600 })
  let dispatches = 0
  const next = await openAgentTasks({ directory, createWorker: async () => { dispatches++; return worker('Should not run.') } })
  t.after(() => next.close())
  assert.equal(next.status(task.taskId).state, 'interrupted')
  assert.equal(next.status(task.taskId).verification.status, 'needs_review')
  assert.equal(dispatches, 0)
  await next.close()
})

test('another runtime cannot own the same registry and linked private state is refused', async t => {
  const { runtime, directory, root } = await fixture(t, async () => worker('Done.'))
  await assert.rejects(openAgentTasks({ directory, createWorker: async () => worker('Duplicate.') }), /owned|unavailable/i)
  await runtime.close()
  const outside = join(root, 'outside.json'), state = join(directory, 'state.json')
  const original = JSON.stringify({ version: 1, identities: [], tasks: [] })
  await writeFile(outside, original, { mode: 0o600 })
  if (process.platform === 'win32') protectProactivePath(outside)
  await rm(state, { force: true })
  // Given a file alias, when a registry opens, then reject shared state without changing its external target.
  await link(outside, state)
  await assert.rejects(openAgentTasks({ directory, createWorker: async () => worker('Bad.') }), /unsafe|unavailable/i)
  assert.equal(await readFile(outside, 'utf8'), original)
  await rm(state)
  // Given unavailable Windows symlink privileges, then skip only this fixture and retain ownership and hardlink checks.
  await t.test('symbolic task state is refused when link creation is available', async child => {
    try { await symlink(outside, state) } catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') { child.skip('Windows fixture requires symbolic link creation permission'); return }
      throw error
    }
    try {
      await assert.rejects(openAgentTasks({ directory, createWorker: async () => worker('Bad.') }), /unsafe|unavailable/i)
      assert.equal(await readFile(outside, 'utf8'), original)
    } finally { await rm(state, { force: true }) }
  })
})

test('cancelling immediately after admission cannot dispatch the queued worker', async t => {
  let created = 0
  const { runtime } = await fixture(t, async () => { created++; return worker('Too late.') })
  const task = runtime.start({ request: 'Read sources.' })
  runtime.cancel(task.taskId)
  assert.equal((await runtime.wait(task.taskId)).state, 'cancelled')
  assert.equal(created, 0)
})

test('continuing an inactive exact task retains its home and verified completion separately', async t => {
  const homes = []
  const { runtime } = await fixture(t, async spec => { homes.push(spec.home); return { ...worker(spec.request), lastTaskResult: {
    verification: { status: 'passed', summary: 'Checked all supplied measurements.' }, learning: { status: 'applied' },
  } } })
  const task = runtime.start({ request: 'First instruction.' })
  assert.equal((await runtime.wait(task.taskId)).verification.status, 'passed')
  runtime.input(task.taskId, 'Second instruction.')
  const result = await runtime.wait(task.taskId)
  assert.equal(result.turn, 2)
  assert.equal(result.response, 'Second instruction.')
  assert.equal(result.learning, 'applied')
  assert.equal(homes[0], homes[1])
})

test('identity tools read the saved role before a revision-bound avatar update', async t => {
  const { runtime } = await fixture(t, async () => worker('Done.'))
  runtime.saveIdentity(identity)
  const tools = createAgentTaskTools(runtime)
  const read = tools.find(tool => tool.name === 'agent_identity_read')
  assert(read)
  const current = (await read.execute('read', { id: identity.id })).structuredContent.value
  assert.equal(current.role, identity.role)
  const save = tools.find(tool => tool.name === 'agent_identity_save')
  const { revision, ...definition } = current
  const result = await save.execute('save', { ...definition, avatar: 'code', expectedRevision: revision })
  assert.equal(result.structuredContent.value.role, identity.role)
  assert.equal(result.structuredContent.value.avatar, 'code')
  await assert.rejects(read.execute('read', { id: '../escape' }))
  assert.throws(() => runtime.saveIdentity({ ...identity, id: 'invalid-name', name: 'invalid\tname' }), /identity/i)
})

test('a persisted task cannot use a saved identity snapshot with a missing id', async t => {
  const { runtime, directory } = await fixture(t, async () => worker('Finished.'))
  runtime.saveIdentity(identity)
  const task = runtime.start({ identityId: identity.id, request: 'Read report.' })
  await runtime.wait(task.taskId)
  await runtime.close()
  const file = join(directory, 'state.json')
  const state = JSON.parse(await readFile(file, 'utf8'))
  delete state.tasks[0].identity.id
  await writeFile(file, JSON.stringify(state))
  await assert.rejects(openAgentTasks({ directory, createWorker: async () => worker('Not admitted.') }), /unsafe|unavailable/)
})
