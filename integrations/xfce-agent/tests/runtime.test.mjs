import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir, readFile, writeFile, symlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDesktopRuntime } from '../src/runtime.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const request = () => ({ requestId: randomUUID(), goal: 'Inspect the fixture.', desktopId: 'anonymous-chrome' });
const image = { png: Buffer.from('synthetic image'), width: 800, height: 600 };
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'xfce-runtime-'));
  let captures = 0, actions = 0, releases = 0;
  const runtime = await openDesktopRuntime({ directory,
    driver: { capture: async () => { captures++; return image; }, act: async () => { actions++; }, release: async () => { releases++; }, ...overrides.driver },
    decide: overrides.decide ?? (async ({ frame }) => ({ frameId: frame.id, action: { type: 'done' } })),
    verify: overrides.verify ?? (async () => ({ passed: true, checks: ['Fixture state checked.'], summary: 'Fixture verified.' })),
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'driver')) });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  return { runtime, directory, counts: () => ({ captures, actions, releases }) };
}
async function settled(runtime, taskId) {
  for (let n = 0; n < 200; n++) {
    const value = await runtime.status(taskId);
    if (!['running', 'queued', 'pausing', 'cancelling'].includes(value.status)) return value;
    await new Promise(r => setTimeout(r, 2));
  }
  throw Error('Task did not settle');
}

test('admission is idempotent and excludes concurrent desktop ownership', async t => {
  const pending = deferred();
  const { runtime } = await fixture(t, { decide: () => pending.promise });
  const input = request();
  const first = await runtime.submit(input);
  assert.equal((await runtime.submit(input)).taskId, first.taskId);
  await assert.rejects(runtime.submit({ ...input, goal: 'Another goal' }));
  await assert.rejects(runtime.submit(request()));
  const cancellation = runtime.cancel(first.taskId);
  pending.resolve({ frameId: 'stale', action: { type: 'click', x: 1, y: 1 } });
  await cancellation;
});

test('model done requires independent verification and results contain references', async t => {
  const { runtime, directory } = await fixture(t, { verify: async () => ({ passed: false, summary: 'Not established.', checks: [] }) });
  const task = await runtime.submit(request());
  assert.equal((await settled(runtime, task.taskId)).status, 'needs_review');
  const result = await runtime.result(task.taskId);
  assert.equal(result.verification.passed, false);
  assert.ok(result.evidenceRefs.length > 0);
  assert.equal(JSON.stringify(result).includes('base64'), false);
  assert.equal(JSON.stringify(result).includes('synthetic image'), false);
  assert.equal((await readFile(join(directory, 'state.json'), 'utf8')).includes('synthetic image'), false);
});

test('late capture cannot reach the model or evidence after takeover', async t => {
  const capture = deferred(), started = deferred(); let decisions = 0;
  const { runtime, directory, counts } = await fixture(t, { driver: { capture: async () => { started.resolve(); return capture.promise; } }, decide: async () => { decisions++; } });
  const task = await runtime.submit(request()); await started.promise;
  let paused = false;
  const barrier = runtime.pause(task.taskId, { reason: 'login' }).then(() => { paused = true; });
  await new Promise(r => setTimeout(r, 5)); assert.equal(paused, false);
  capture.resolve(image); await barrier;
  assert.equal(decisions, 0); assert.equal(counts().releases, 1);
  assert.deepEqual(await readdir(join(directory, 'evidence')), []);
  const status = await runtime.status(task.taskId);
  assert.equal(status.status, 'waiting_for_user');
  assert.equal('interventionId' in status, false);
  assert.equal('interventionId' in await runtime.result(task.taskId), false);
  const ticket = await runtime.getPrivateTicket(task.taskId);
  await assert.rejects(runtime.resume(task.taskId, { ...ticket }));
  await assert.rejects(runtime.resume(task.taskId, { ...ticket, interventionId: randomUUID(), operator: true }));
});

test('late model decision cannot actuate after private takeover; resume uses a new epoch', async t => {
  const decision = deferred(), started = deferred(); let calls = 0; const epochs = [];
  const { runtime, counts } = await fixture(t, { decide: async ({ frame }) => {
    epochs.push(frame.epoch);
    if (calls++ === 0) { started.resolve(); return decision.promise; }
    return { frameId: frame.id, action: { type: 'done' } };
  } });
  const task = await runtime.submit(request()); await started.promise;
  const pausing = runtime.pause(task.taskId, { reason: 'login' });
  decision.resolve({ frameId: 'old', action: { type: 'click', x: 1, y: 1 } }); await pausing;
  assert.equal(counts().actions, 0);
  const ticket = await runtime.getPrivateTicket(task.taskId);
  await runtime.resume(task.taskId, { ...ticket, operator: true });
  assert.equal((await settled(runtime, task.taskId)).status, 'completed');
  assert.ok(epochs[1] > epochs[0]);
});

test('cancel drains an action and releases input before completion', async t => {
  const action = deferred(), started = deferred();
  const { runtime, counts } = await fixture(t, { decide: async ({ frame }) => ({ frameId: frame.id, action: { type: 'click', x: 2, y: 2 } }), driver: { act: async () => { started.resolve(); return action.promise; } } });
  const task = await runtime.submit(request()); await started.promise;
  let cancelled = false;
  const barrier = runtime.cancel(task.taskId).then(() => { cancelled = true; });
  await new Promise(r => setTimeout(r, 5)); assert.equal(cancelled, false);
  action.resolve(); await barrier;
  assert.equal((await runtime.status(task.taskId)).status, 'cancelled');
  assert.equal(counts().releases, 1);
});

test('failed action remains unknown and cannot resume without reconciliation', async t => {
  const { runtime } = await fixture(t, { decide: async ({ frame }) => ({ frameId: frame.id, action: { type: 'click', x: 2, y: 2 } }), driver: { act: async () => { throw Error('credential: DO-NOT-LOG'); } } });
  const task = await runtime.submit(request());
  const status = await settled(runtime, task.taskId);
  assert.equal(status.status, 'reconciling'); assert.equal(status.mutationOutcome, 'unknown');
  assert.equal(JSON.stringify(await runtime.result(task.taskId)).includes('DO-NOT-LOG'), false);
  await assert.rejects(runtime.resume(task.taskId, { expectedRevision: status.revision }));
  await runtime.reconcile(task.taskId);
  assert.equal((await runtime.status(task.taskId)).status, 'interrupted');
});

test('private waits survive restart and a second owner is refused', async t => {
  const { runtime, directory } = await fixture(t, { decide: async ({ frame }) => ({ frameId: frame.id, action: { type: 'private' } }) });
  const pending = deferred();
  const second = openDesktopRuntime({ directory, driver: { capture: async () => image, act: async () => {}, release: async () => {} }, decide: () => pending.promise, verify: () => {} });
  await assert.rejects(second, /owner/);
  const task = await runtime.submit(request()); await settled(runtime, task.taskId);
  await runtime.close();
  const reopened = await openDesktopRuntime({ directory, driver: { capture: async () => { throw Error('Do not capture'); }, act: async () => {}, release: async () => {} }, decide: () => pending.promise, verify: async () => ({ passed: false }) });
  assert.equal((await reopened.status(task.taskId)).status, 'waiting_for_user');
  await reopened.close();
});

test('shutdown aborts and drains a pending decision before releasing ownership', async t => {
  const decision = deferred(), started = deferred(); let aborted = false;
  const { runtime, counts } = await fixture(t, { decide: async ({ signal }) => {
    signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    started.resolve(); return decision.promise;
  } });
  const task = await runtime.submit(request()); await started.promise;
  let closed = false;
  const closing = runtime.close().then(() => { closed = true; });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(aborted, true); assert.equal(closed, false);
  decision.resolve({ frameId: 'old', action: { type: 'click', x: 2, y: 2 } });
  await closing;
  assert.equal(counts().actions, 0); assert.equal(counts().releases, 1);
  assert.equal((await runtime.status(task.taskId)).status, 'interrupted');
});

test('guard enters private waiting before any AI observation', async t => {
  let captures = 0, decisions = 0;
  const { runtime } = await fixture(t, { driver: { guard: async () => ({ privacyRequired: true, reason: 'DO-NOT-LOG' }), capture: async () => { captures++; return image; } }, decide: async () => { decisions++; } });
  const task = await runtime.submit(request());
  assert.equal((await settled(runtime, task.taskId)).status, 'waiting_for_user');
  assert.equal(captures, 0); assert.equal(decisions, 0);
  assert.equal(JSON.stringify(await runtime.result(task.taskId)).includes('DO-NOT-LOG'), false);
});

test('cancelled unknown effects retain desktop ownership until independently reconciled', async t => {
  const { runtime } = await fixture(t, { decide: async ({ frame }) => ({ frameId: frame.id, action: { type: 'click', x: 2, y: 2 } }), driver: { act: async () => { throw Error('Unknown'); } } });
  const task = await runtime.submit(request()); await settled(runtime, task.taskId);
  await runtime.cancel(task.taskId);
  assert.equal((await runtime.status(task.taskId)).mutationOutcome, 'unknown');
  await assert.rejects(runtime.submit(request()));
  await runtime.reconcile(task.taskId);
  assert.equal((await runtime.status(task.taskId)).status, 'cancelled');
  assert.equal((await runtime.status(task.taskId)).mutationOutcome, 'known');
});

test('shutdown aborts reconciliation and ignores its late success', async t => {
  const result = deferred(), started = deferred(); let aborted = false;
  const { runtime } = await fixture(t, { decide: async ({ frame }) => ({ frameId: frame.id, action: { type: 'click', x: 2, y: 2 } }), driver: { act: async () => { throw Error('Unknown'); } }, verify: async ({ signal }) => {
    signal.addEventListener('abort', () => { aborted = true; }, { once: true }); started.resolve(); return result.promise;
  } });
  const task = await runtime.submit(request()); await settled(runtime, task.taskId);
  const checking = runtime.reconcile(task.taskId);
  const rejected = assert.rejects(checking, /not established/);
  await started.promise;
  let closed = false;
  const closing = runtime.close().then(() => { closed = true; });
  await new Promise(r => setTimeout(r, 5)); assert.equal(aborted, true); assert.equal(closed, false);
  result.resolve({ passed: true, checks: [], summary: 'Late success.' });
  await rejected; await closing;
  assert.equal((await runtime.status(task.taskId)).mutationOutcome, 'unknown');
});

test('a killed owner recovers a pending journal without replaying its action', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'xfce-crash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const moduleUrl = new URL('../src/runtime.mjs', import.meta.url).href;
  const input = request();
  const source = `import { openDesktopRuntime } from ${JSON.stringify(moduleUrl)};
    const runtime = await openDesktopRuntime({directory:${JSON.stringify(directory)},
      driver:{capture:async()=>({png:Buffer.from('image'),width:800,height:600}),act:async()=>{process.stdout.write('DISPATCHED\\n');return new Promise(()=>{});},release:async()=>{}},
      decide:async({frame})=>({frameId:frame.id,action:{type:'click',x:2,y:2}}),verify:async()=>({passed:true,checks:[],summary:'Checked.'})});
    await runtime.submit(${JSON.stringify(input)});setInterval(()=>{},1000);`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = new Promise(resolve => child.once('exit', resolve));
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', bytes => { output += bytes; if (output.includes('DISPATCHED')) resolve(); });
    child.once('error', reject);
    child.once('exit', code => reject(Error('Child exited before dispatch: ' + code)));
  });
  child.kill('SIGKILL'); await exited;
  let actions = 0;
  const runtime = await openDesktopRuntime({ directory, driver: { capture: async () => image, act: async () => { actions++; }, release: async () => {} }, decide: async ({ frame }) => ({ frameId: frame.id, action: { type: 'done' } }), verify: async () => ({ passed: true, checks: [], summary: 'Checked.' }) });
  try {
    const stored = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8')).tasks[0];
    assert.equal((await runtime.status(stored.taskId)).status, 'reconciling');
    assert.equal((await runtime.status(stored.taskId)).mutationOutcome, 'unknown');
    assert.equal(actions, 0);
    await assert.rejects(runtime.resume(stored.taskId, { expectedRevision: stored.revision }));
    await runtime.reconcile(stored.taskId);
    const recovered = await runtime.status(stored.taskId);
    assert.equal(recovered.status, 'interrupted'); assert.equal(actions, 0);
    await runtime.resume(stored.taskId, { expectedRevision: recovered.revision });
    assert.equal((await settled(runtime, stored.taskId)).status, 'completed');
    assert.equal(actions, 0);
  } finally { await runtime.close(); }
});

test('linked state files are refused without modifying their targets', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'xfce-linked-'));
  const outside = join(directory, 'outside.json');
  await writeFile(outside, '{"private":"unchanged"}', { mode: 0o600 });
  await symlink(outside, join(directory, 'state.json'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(openDesktopRuntime({ directory, driver: { capture: async () => image, act: async () => {}, release: async () => {} }, decide: async () => {}, verify: async () => {} }), /state/);
  assert.equal(await readFile(outside, 'utf8'), '{"private":"unchanged"}');
});

test('a private page that appears during capture never enters evidence or the model', async t => {
  let privatePage = false, decisions = 0;
  const { runtime, directory } = await fixture(t, {
    driver: { guard: async () => ({ privacyRequired: privatePage }), capture: async () => { privatePage = true; return image; } },
    decide: async () => { decisions++; throw Error('Do not inspect private pixels'); },
  });
  const task = await runtime.submit(request());
  assert.equal((await settled(runtime, task.taskId)).status, 'waiting_for_user');
  assert.equal(decisions, 0);
  assert.deepEqual(await readdir(join(directory, 'evidence')), []);
});

test('evidence has a bounded total byte budget', async t => {
  const { runtime, directory } = await fixture(t, { maxEvidenceBytes: 2 });
  const task = await runtime.submit(request());
  assert.equal((await settled(runtime, task.taskId)).status, 'failed');
  assert.deepEqual(await readdir(join(directory, 'evidence')), []);
});

async function storageFaultFixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'xfce-storage-fault-'));
  let fail = false, releases = 0, actions = 0;
  const entered = deferred(), allow = deferred();
  const { openDesktopStore } = await import('../src/store.mjs');
  const runtime = await openDesktopRuntime({ directory,
    createStore: async path => {
      const store = await openDesktopStore(path);
      return { ...store, write: value => {
        if (fail) return Promise.reject(Error('Injected disk failure'));
        if (options.blockCompleted && value.tasks.some(task => task.status === 'completed')) {
          entered.resolve();
          return allow.promise.then(() => store.write(value));
        }
        return store.write(value);
      } };
    },
    driver: { capture: async () => image, act: async () => { actions++; if (options.failAfterAction) fail = true; }, release: async () => { releases++; } },
    decide: async ({ frame }) => ({ frameId: frame.id, action: { type: options.failAfterAction ? 'click' : 'done', x: 2, y: 2 } }),
    verify: async () => ({ passed: true, checks: [], summary: 'Verified.' }),
  });
  t.after(async () => { allow.resolve(); await runtime.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return { runtime, fail: () => { fail = true; }, entered, allow, counts: () => ({ releases, actions }) };
}

test('Given failed admission persistence When the same request is repeated Then no phantom task is admitted', async t => {
  const { runtime, fail, counts } = await storageFaultFixture(t);
  const input = request(); fail();
  await assert.rejects(runtime.submit(input), /storage/i);
  await assert.rejects(runtime.submit(input), /storage/i);
  await assert.rejects(runtime.submit(request()), /storage/i);
  assert.equal(counts().actions, 0);
});

test('Given an uncommitted completion When status is read Then only the committed snapshot is visible', { timeout: 3000 }, async t => {
  const { runtime, entered, allow } = await storageFaultFixture(t, { blockCompleted: true });
  const task = await runtime.submit(request()); await entered.promise;
  const status = await runtime.status(task.taskId), result = await runtime.result(task.taskId);
  assert.equal(status.status, 'running');
  assert.equal(result.status, 'running');
  assert.equal(result.verification, undefined);
  allow.resolve();
  assert.equal((await settled(runtime, task.taskId)).status, 'completed');
});

test('Given action settlement cannot persist When execution stops Then input releases and every API is fenced', async t => {
  const { runtime, counts } = await storageFaultFixture(t, { failAfterAction: true });
  const task = await runtime.submit(request());
  for (let n = 0; n < 200 && counts().releases === 0; n++) await new Promise(resolve => setTimeout(resolve, 2));
  assert.equal(counts().actions, 1);
  assert.equal(counts().releases, 1);
  await assert.rejects(runtime.status(task.taskId), /storage/i);
  await assert.rejects(runtime.result(task.taskId), /storage/i);
  await assert.rejects(runtime.resume(task.taskId, { expectedRevision: task.revision }), /storage/i);
  await assert.rejects(runtime.submit(request()), /storage/i);
});

test('Given a submission validator When a request is replayed Then validation runs only before a new admission', async t => {
  let validations = 0;
  const pending = deferred();
  const { runtime } = await fixture(t, { validateSubmission: async value => {
    validations++; assert.equal(value.desktopId, 'anonymous-chrome');
    if (value.goal === 'unsupported') throw Error('Unsupported fixture goal');
  }, decide: () => pending.promise });
  const input = request();
  await assert.rejects(runtime.submit({ ...input, goal: 'unsupported' }), /Unsupported/);
  const task = await runtime.submit(input);
  assert.equal((await runtime.submit(input)).taskId, task.taskId);
  assert.equal(validations, 2);
  const cancellation = runtime.cancel(task.taskId);
  pending.resolve({ frameId: 'stale', action: { type: 'done' } });
  await cancellation;
});

test('Given visual provider quota refusal When a task stops Then the result reports no completion and sends no input', async t => {
  const { runtime, counts } = await fixture(t, { decide: async () => { throw Object.assign(Error('untrusted upstream secret'), { code: 'visual_provider_rate_limited' }); } });
  const task = await runtime.submit(request());
  assert.equal((await settled(runtime, task.taskId)).status, 'failed');
  const result = await runtime.result(task.taskId);
  assert.match(result.summary, /rate limited.*No completion/);
  assert.ok(!JSON.stringify(result).includes('upstream secret'));
  assert.equal(counts().actions, 0);
});

test('Given privacy begins during a pending model decision When it returns Then its public-frame action cannot reach the private page', async t => {
  const started = deferred(), decision = deferred(); let privatePage = false;
  const { runtime, counts } = await fixture(t, { driver: { guard: async () => ({ privacyRequired: privatePage }) }, decide: async ({ frame }) => { started.resolve(); await decision.promise; return { frameId: frame.id, action: { type: 'click', x: 1, y: 1 } }; } });
  const task = await runtime.submit(request()); await started.promise;
  privatePage = true; decision.resolve();
  assert.equal((await settled(runtime, task.taskId)).status, 'waiting_for_user');
  assert.equal(counts().actions, 0);
});
