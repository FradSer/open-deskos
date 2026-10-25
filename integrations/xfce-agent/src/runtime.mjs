import { randomUUID, createHash } from 'node:crypto';
import { open, unlink, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { openDesktopStore } from './store.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNED = new Set(['queued', 'running', 'pausing', 'cancelling', 'waiting_for_user', 'interrupted', 'reconciling']);
const STATUSES = new Set([...OWNED, 'completed', 'needs_review', 'failed', 'cancelled']);
const copy = value => structuredClone(value);
const now = () => new Date().toISOString();
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function admission(value) {
  if (!value || !UUID.test(value.requestId ?? '') || value.desktopId !== 'anonymous-chrome' || typeof value.goal !== 'string' || !value.goal.trim() || value.goal.length > 4096 || Object.keys(value).some(key => !['requestId', 'goal', 'desktopId', 'constraints'].includes(key))) throw Error('Invalid desktop task request.');
  let checked;
  try { checked = JSON.parse(JSON.stringify(value)); } catch { throw Error('Invalid desktop task request.'); }
  if (Buffer.byteLength(JSON.stringify(checked)) > 16384) throw Error('Desktop request exceeds its limit.');
  return checked;
}
function validAction(value, frame) {
  if (!value || value.frameId !== frame.id || !value.action) throw Error('Invalid desktop action.');
  const a = value.action;
  if (a.type === 'click') {
    if (![a.x, a.y].every(Number.isInteger) || a.x < 0 || a.x >= frame.width || a.y < 0 || a.y >= frame.height) throw Error('Invalid desktop action.');
  } else if (a.type === 'type') {
    if (typeof a.text !== 'string' || !a.text || a.text.length > 4096 || /[\x00-\x1f\x7f]/.test(a.text)) throw Error('Invalid desktop action.');
  } else if (a.type === 'key') {
    if (typeof a.key !== 'string' || !/^[A-Za-z0-9+_-]{1,64}$/.test(a.key)) throw Error('Invalid desktop action.');
  } else if (a.type === 'scroll') {
    if (!Number.isInteger(a.dy) || Math.abs(a.dy) > 2000) throw Error('Invalid desktop action.');
  } else if (a.type === 'wait') {
    if (!Number.isInteger(a.ms) || a.ms < 1 || a.ms > 5000) throw Error('Invalid desktop action.');
  } else if (!['done', 'private'].includes(a.type)) throw Error('Invalid desktop action.');
  return copy(a);
}
function checkedVerification(value) {
  if (!value || typeof value.passed !== 'boolean' || typeof value.summary !== 'string' || value.summary.length > 2048 || !Array.isArray(value.checks) || value.checks.length > 64) throw Error('Invalid verification result.');
  const result = { passed: value.passed, summary: value.summary, checks: copy(value.checks) };
  if (Buffer.byteLength(JSON.stringify(result)) > 16384) throw Error('Invalid verification result.');
  return result;
}

/** Own one desktop. Injected drivers enforce desktop and account policy. */
export async function openDesktopRuntime({ directory, driver, decide, verify, maxSteps = 25, maxEvidenceBytes = 128 * 1024 * 1024, onUpdate, createStore = openDesktopStore, validateSubmission } = {}) {
  if (!driver || typeof driver.capture !== 'function' || typeof driver.act !== 'function' || typeof driver.release !== 'function' || typeof decide !== 'function' || typeof verify !== 'function' || !Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw Error('Invalid desktop runtime configuration.');
  if (!Number.isInteger(maxEvidenceBytes) || maxEvidenceBytes < 1 || maxEvidenceBytes > 1024 * 1024 * 1024) throw Error('Invalid evidence budget.');
  const store = await createStore(directory);
  let evidenceBytes = 0;
  try {
    for (const name of await readdir(store.evidenceDirectory)) {
      const file = await lstat(join(store.evidenceDirectory, name));
      if (!file.isFile() || file.isSymbolicLink() || file.nlink !== 1) throw Error('Invalid evidence file.');
      evidenceBytes += file.size;
    }
    if (evidenceBytes > maxEvidenceBytes) throw Error('Evidence budget exceeded.');
  } catch { await store.close().catch(() => {}); throw Error('Desktop evidence is unavailable.'); }
  let state;
  try {
    state = await store.read();
    if (state.version !== 1 || !Array.isArray(state.tasks) || state.tasks.length > 128 || state.tasks.some(task => !UUID.test(task.taskId ?? '') || !UUID.test(task.requestId ?? '') || !Number.isInteger(task.epoch) || task.epoch < 1 || !Number.isInteger(task.revision) || task.revision < 1 || !STATUSES.has(task.status) || !['none', 'known', 'unknown'].includes(task.mutationOutcome) || !Array.isArray(task.evidenceRefs) || task.evidenceRefs.some(ref => typeof ref !== 'string' || !/^evidence\/[a-f0-9-]{36}-[a-f0-9-]{36}\.png$/.test(ref)) || (task.status === 'waiting_for_user' && !UUID.test(task.interventionId ?? ''))) || new Set(state.tasks.map(task => task.taskId)).size !== state.tasks.length || new Set(state.tasks.map(task => task.requestId)).size !== state.tasks.length || state.tasks.filter(task => OWNED.has(task.status)).length > 1) throw Error('Invalid desktop runtime state.');
    for (const task of state.tasks) {
      if (['queued', 'running', 'pausing', 'cancelling'].includes(task.status)) {
        task.epoch++; task.revision++; task.updatedAt = now();
        task.status = task.journal?.status === 'dispatching' || task.mutationOutcome === 'unknown' ? 'reconciling' : 'interrupted';
        if (task.status === 'reconciling') task.mutationOutcome = 'unknown';
        task.summary = 'Execution was interrupted. Explicit recovery is required.';
      }
    }
    await store.write(state);
  } catch { await store.close().catch(() => {}); throw Error('Desktop runtime state is unavailable.'); }
  let closed = false, storageFailed = false, closing, owner, maintenance, transitions = Promise.resolve();
  const committed = new Map(state.tasks.map(task => [task.taskId, copy(task)]));
  const requireStorage = () => { if (storageFailed) throw Error('Desktop storage is unavailable; runtime recovery is required.'); };
  const getCommitted = taskId => { requireStorage(); const task = committed.get(taskId); if (!task) throw Error('Unknown desktop task.'); return task; };
  const get = taskId => { const task = state.tasks.find(item => item.taskId === taskId); if (!task) throw Error('Unknown desktop task.'); return task; };
  const metadata = task => ({ taskId: task.taskId, requestId: task.requestId, desktopId: task.desktopId, goal: task.goal, ...(task.constraints === undefined ? {} : { constraints: copy(task.constraints) }), status: task.status, revision: task.revision, epoch: task.epoch, mutationOutcome: task.mutationOutcome, createdAt: task.createdAt, updatedAt: task.updatedAt });
  async function persist(task, event) {
    requireStorage();
    task.revision++; task.updatedAt = now();
    if (event) task.audit = [...(task.audit ?? []).slice(-63), { event, at: task.updatedAt, epoch: task.epoch }];
    const snapshot = copy(state);
    try { await store.write(snapshot); }
    catch {
      storageFailed = true;
      owner?.controller.abort();
      maintenance?.controller.abort();
      throw Error('Desktop storage is unavailable; runtime recovery is required.');
    }
    for (const saved of snapshot.tasks) committed.set(saved.taskId, copy(saved));
    if (onUpdate) { try { void Promise.resolve(onUpdate(metadata(getCommitted(task.taskId)))).catch(() => {}); } catch { /* Observers cannot change execution. */ } }
  }
  function current(run) { return !closed && !storageFailed && owner === run && run.task.epoch === run.epoch && run.task.status === 'running' && !run.controller.signal.aborted; }
  function requireCurrent(run) { if (!current(run)) throw Error('Desktop operation superseded.'); }
  const serialize = operation => {
    const next = transitions.then(operation);
    transitions = next.catch(() => {});
    return next;
  };
  async function saveFrame(run, capture) {
    requireCurrent(run);
    if (!Buffer.isBuffer(capture?.png) || capture.png.length === 0 || capture.png.length > 8 * 1024 * 1024 || !Number.isInteger(capture.width) || !Number.isInteger(capture.height) || capture.width < 1 || capture.height < 1 || capture.width > 8192 || capture.height > 8192) throw Error('Desktop observation unavailable.');
    if (run.task.evidenceRefs.length >= 100 || evidenceBytes + capture.png.length > maxEvidenceBytes) throw Error('Desktop evidence budget exceeded.');
    const id = randomUUID();
    const relative = 'evidence/' + run.task.taskId + '-' + id + '.png';
    const filename = join(store.directory, relative);
    const file = await open(filename, 'wx', 0o600);
    try { await file.writeFile(capture.png); await file.sync(); } finally { await file.close(); }
    if (!current(run)) { await unlink(filename); requireCurrent(run); }
    evidenceBytes += capture.png.length;
    run.task.evidenceRefs.push(relative);
    await persist(run.task);
    requireCurrent(run);
    return { id, epoch: run.epoch, png: capture.png, width: capture.width, height: capture.height };
  }
  async function release(run) {
    if (run.released) return;
    await driver.release(); run.released = true;
  }
  async function privateFromRun(run) {
    requireCurrent(run);
    run.task.epoch++; run.controller.abort(); run.task.status = 'pausing';
    await persist(run.task, 'private_pause_requested');
    await release(run);
    run.task.status = 'waiting_for_user'; run.task.interventionId = randomUUID();
    run.task.summary = 'Waiting for private operator input.';
    await persist(run.task, 'private_wait_ready');
  }
  async function execute(run) {
    const task = run.task, signal = run.controller.signal;
    const context = { taskId: task.taskId, epoch: run.epoch, task: metadata(task), signal };
    const history = [];
    try {
      for (let step = 0; step < maxSteps; step++) {
        requireCurrent(run);
        const guard = driver.guard ? await driver.guard(context) : {};
        requireCurrent(run);
        if (guard?.privacyRequired) { await privateFromRun(run); return; }
        const capture = await driver.capture(context);
        requireCurrent(run);
        const afterCapture = driver.guard ? await driver.guard(context) : {};
        requireCurrent(run);
        if (afterCapture?.privacyRequired) { await privateFromRun(run); return; }
        const frame = await saveFrame(run, capture);
        const decision = await decide({ task: metadata(task), frame, history: copy(history), signal });
        requireCurrent(run);
        const beforeAction = driver.guard ? await driver.guard(context) : {};
        requireCurrent(run);
        if (beforeAction?.privacyRequired) { await privateFromRun(run); return; }
        const action = validAction(decision, frame);
        if (action.type === 'private') { await privateFromRun(run); return; }
        if (action.type === 'done') {
          const result = checkedVerification(await verify({ task: metadata(task), signal }));
          requireCurrent(run);
          await release(run); requireCurrent(run);
          task.verification = result; task.status = result.passed ? 'completed' : 'needs_review'; task.summary = result.summary;
          await persist(task, result.passed ? 'verified_completion' : 'verification_requires_review');
          return;
        }
        // Write intent before dispatch. Unconfirmed effects survive process loss.
        task.journal = { actionId: randomUUID(), type: action.type, frameId: frame.id, epoch: run.epoch, status: 'dispatching' };
        task.mutationOutcome = 'unknown';
        await persist(task, 'action_dispatch_reserved'); requireCurrent(run);
        await driver.act(action, context);
        // Settlement confirms dispatch only; the verifier establishes task effects.
        task.journal.status = 'known'; task.mutationOutcome = 'known';
        await persist(task);
        requireCurrent(run);
        history.push({ frameId: frame.id, action, outcome: 'Input dispatched. Inspect the next observation.' });
      }
      await release(run); requireCurrent(run);
      task.status = 'needs_review'; task.summary = 'The desktop step limit was reached.';
      await persist(task, 'step_limit');
    } catch (error) {
      if (!current(run)) return;
      task.epoch++; run.controller.abort();
      task.status = task.mutationOutcome === 'unknown' ? 'reconciling' : 'failed';
      task.summary = task.status === 'reconciling' ? 'An action outcome is unknown. Independent reconciliation is required.' : error?.code === 'visual_provider_rate_limited' ? 'The configured visual provider is rate limited. No completion was established.' : 'Desktop execution failed.';
      await persist(task, 'execution_stopped');
    } finally {
      // Input release must not depend on another successful journal write.
      try { await release(run); }
      catch {
        run.controller.abort(); task.status = 'reconciling'; task.mutationOutcome = 'unknown';
        task.summary = 'Input release requires operator recovery.';
        if (!storageFailed) await persist(task, 'release_unconfirmed');
      }
    }
  }
  function start(task) {
    const run = { task, epoch: task.epoch, controller: new AbortController(), released: false };
    owner = run;
    run.promise = execute(run);
    void run.promise.catch(() => { run.controller.abort(); });
  }
  async function transition(task, status, reason) {
    if (!OWNED.has(task.status)) throw Error('Desktop task is no longer active.');
    const run = owner?.task === task ? owner : undefined;
    task.epoch++; task.status = status === 'waiting_for_user' ? 'pausing' : 'cancelling';
    run?.controller.abort();
    try { await persist(task, reason); }
    finally {
      if (run) { try { await run.promise; } finally { await release(run); } }
      else await driver.release();
    }
    task.status = status === 'interrupted' && task.mutationOutcome === 'unknown' ? 'reconciling' : status;
    if (status === 'waiting_for_user') task.interventionId = randomUUID();
    else delete task.interventionId;
    task.summary = status === 'waiting_for_user' ? 'Waiting for private operator input.' : task.status === 'reconciling' ? 'An action outcome is unknown. Independent reconciliation is required.' : status === 'interrupted' ? 'Execution was interrupted. Explicit recovery is required.' : 'Desktop task was cancelled.';
    await persist(task, status === 'waiting_for_user' ? 'private_wait_ready' : 'execution_drained');
  }
  const api = {
    submit(input) { return serialize(async () => {
      requireStorage(); if (closed) throw Error('Desktop runtime is closed.');
      const checked = admission(input), digest = createHash('sha256').update(canonical(checked)).digest('hex');
      const previous = state.tasks.find(task => task.requestId === checked.requestId);
      if (previous) { if (previous.requestDigest !== digest) throw Error('Request identity already has another payload.'); return metadata(getCommitted(previous.taskId)); }
      if (state.tasks.some(task => OWNED.has(task.status) || task.mutationOutcome === 'unknown') || (owner && !owner.released)) throw Error('Desktop is already reserved.');
      if (state.tasks.length >= 128) throw Error('Desktop task capacity reached.');
      if (validateSubmission) await validateSubmission(copy(checked));
      requireStorage(); if (closed) throw Error('Desktop runtime is closed.');
      const task = { ...checked, taskId: randomUUID(), requestDigest: digest, status: 'running', revision: 0, epoch: 1, mutationOutcome: 'none', evidenceRefs: [], createdAt: now(), updatedAt: now(), summary: 'Desktop task admitted.' };
      state.tasks.push(task); await persist(task, 'admitted'); start(task); return metadata(getCommitted(task.taskId));
    }); },
    async status(taskId) { return metadata(getCommitted(taskId)); },
    async result(taskId) { const task = getCommitted(taskId); return { taskId, status: task.status, mutationOutcome: task.mutationOutcome, summary: task.summary, evidenceRefs: [...task.evidenceRefs], ...(task.verification ? { verification: copy(task.verification) } : {}) }; },
    pause(taskId) { if (maintenance?.taskId === taskId) maintenance.controller.abort(); return serialize(async () => { requireStorage(); if (closed) throw Error('Desktop runtime is closed.'); const task = get(taskId); if (task.status !== 'waiting_for_user') await transition(task, 'waiting_for_user', 'private_pause_requested'); return metadata(task); }); },
    cancel(taskId) { if (maintenance?.taskId === taskId) maintenance.controller.abort(); return serialize(async () => { requireStorage(); if (closed) throw Error('Desktop runtime is closed.'); const task = get(taskId); if (task.status !== 'cancelled') await transition(task, 'cancelled', 'cancel_requested'); return metadata(task); }); },
    async getPrivateTicket(taskId) { requireStorage(); const task = get(taskId), saved = committed.get(taskId); if (task.status !== 'waiting_for_user' || saved?.status !== 'waiting_for_user' || saved.revision !== task.revision) throw Error('No private intervention is ready.'); return { interventionId: task.interventionId, expectedRevision: task.revision }; },
    resume(taskId, { interventionId, expectedRevision, operator = false } = {}) { return serialize(async () => {
      requireStorage(); if (closed) throw Error('Desktop runtime is closed.');
      const task = get(taskId);
      if (!['waiting_for_user', 'interrupted'].includes(task.status) || task.mutationOutcome === 'unknown' || expectedRevision !== task.revision || (task.status === 'waiting_for_user' && (!operator || interventionId !== task.interventionId))) throw Error('Desktop resume requires the current authorization and a known outcome.');
      if (owner?.task === task) await owner.promise;
      task.epoch++; task.status = 'running'; delete task.interventionId;
      delete task.verification;
      await persist(task, 'explicit_resume'); start(task); return metadata(getCommitted(task.taskId));
    }); },
    reconcile(taskId, { operator = false, interventionId, expectedRevision } = {}) { return serialize(async () => {
      requireStorage(); if (closed) throw Error('Desktop runtime is closed.');
      const task = get(taskId);
      if (task.status === 'waiting_for_user') {
        if (!operator || interventionId !== task.interventionId || expectedRevision !== task.revision || task.mutationOutcome !== 'unknown') throw Error('Private reconciliation requires the current operator authorization.');
        task.status = 'reconciling'; task.epoch++; delete task.interventionId;
        await persist(task, 'operator_ended_private_wait');
      }
      if (task.status !== 'reconciling' && !(task.status === 'cancelled' && task.mutationOutcome === 'unknown')) throw Error('No unknown action needs reconciliation.');
      const cancelled = task.status === 'cancelled';
      if (owner?.task === task) { await owner.promise; await release(owner); }
      const controller = new AbortController();
      maintenance = { taskId, controller };
      try {
        const result = checkedVerification(await verify({ task: metadata(task), signal: controller.signal }));
        controller.signal.throwIfAborted();
        if (closed) throw Error('Runtime closed.');
        task.verification = result;
        if (result.passed) { task.status = cancelled ? 'cancelled' : 'interrupted'; task.mutationOutcome = 'known'; if (task.journal) task.journal.status = 'known'; task.summary = 'Independent reconciliation passed. Explicit resume is required.'; }
        await persist(task, 'reconciliation_checked'); return metadata(task);
      } catch { throw Error('Desktop reconciliation was not established.'); }
      finally { maintenance = undefined; }
    }); },
    close() {
      if (!closing) {
        closed = true;
        owner?.controller.abort();
        maintenance?.controller.abort();
        closing = serialize(async () => {
          let failure;
          try {
            if (!storageFailed) for (const task of state.tasks.filter(task => ['running', 'pausing', 'cancelling'].includes(task.status))) await transition(task, 'interrupted', 'shutdown_requested');
          } catch (error) { failure = error; }
          try { if (owner) await owner.promise; } catch (error) { failure ??= error; }
          try { if (owner) await release(owner); } catch (error) { failure ??= error; }
          try { await store.close(); } catch { failure ??= Error('Desktop storage cleanup did not complete.'); }
          if (failure) throw failure;
        });
      }
      return closing;
    },
  };
  return api;
}
