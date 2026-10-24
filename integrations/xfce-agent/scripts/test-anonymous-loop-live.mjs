#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { RfbFixtureInspector } from './lib/rfb-inspector.mjs';
import { runDesktopDelegation } from '../../personal-bot/scripts/test-desktop-delegation-live.mjs';
import { createDesktopAgentClient } from '../../personal-bot/src/desktop-agent/client.mjs';
import { FIXTURE_GOAL } from '../src/driver.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { config: { type: 'string' }, directory: { type: 'string' }, cases: { type: 'string', default: 'baseline,private,cancel,recovery' }, 'synthetic-worker': { type: 'boolean', default: false } }, strict: true });
if (!values.config || !values.directory) throw Error('Private --config and --directory are required');
process.umask(0o077);
const synthetic = values['synthetic-worker'];
const decisionStarted = row => row.event === (synthetic ? 'synthetic_step' : 'request_started');
const template = JSON.parse(await readFile(values.config, 'utf8'));
const directory = resolve(values.directory);
await mkdir(directory, { recursive: true, mode: 0o700 });
const report = { startedAt: new Date().toISOString(), scope: synthetic ? 'Real CM5 KVM XFCE Chromium fixture; synthetic fixed coordinate controller and synthetic Pi Durable coordinator; no visual model inference' : 'Real CM5 KVM XFCE Chromium fixture, real visual worker, synthetic Pi Durable coordinator', cases: [] };
const monitor = async (path = '/state', options = {}) => {
  const response = await fetch(new URL(path, template.fixtureEndpoint), { ...options, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error('Fixture monitor refused');
  return response.json();
};
async function until(read, predicate, timeoutMs = 240000) {
  const end = Date.now() + timeoutMs;
  do { const value = await read(); if (predicate(value)) return value; await delay(100); } while (Date.now() < end);
  throw Error('Acceptance observation deadline exceeded');
}
async function records(stateDirectory) {
  try { return (await readFile(join(stateDirectory, 'model-requests.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function start(config, configFile) {
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  const child = spawn(process.execPath, [join(root, synthetic ? 'scripts/fixture-controller-worker.mjs' : 'src/main.mjs'), '--config', configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; }); child.stderr.on('data', bytes => { stderr += bytes; });
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  await until(async () => { if (child.exitCode !== null) throw Error('Isolated worker startup failed: ' + stderr.slice(-500)); return stdout; }, text => text.includes('"ready":true'), 20000);
  const client = createDesktopAgentClient({ socketPath: config.rpcSocket });
  const key = JSON.parse(await readFile(join(config.stateDirectory, 'operator-key.json'), 'utf8')).operatorKey;
  const operator = async (taskId, method, input = {}, verb = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${config.operatorPort}/operator/tasks/${taskId}/${method}`, {
      method: verb, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, ...(verb === 'POST' ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json(); if (!result.ok) throw Error('Operator action refused: ' + result.error?.code); return result.result;
  };
  return { child, exit, client, key, operator,
    async stop(signal = 'SIGTERM') {
      client.close(); if (child.exitCode === null && child.signalCode === null) child.kill(signal);
      await Promise.race([exit, delay(15000).then(() => { throw Error('Worker exit unconfirmed'); })]);
      await writeFile(join(config.stateDirectory, 'acceptance-worker-log.json'), JSON.stringify({ stdout, stderr }), { mode: 0o600 });
    },
  };
}
async function delegation(worker, config, phase, request) {
  const receipt = await runDesktopDelegation({ socket: config.rpcSocket, directory: join(directory, 'pi'), phase, request });
  assert.equal(receipt.nestedExecutions, 1); assert.deepEqual(receipt.modelFacingTools, ['codemode']);
  assert.equal(receipt.coordinator.synthetic, true);
  assert.ok(!JSON.stringify(receipt).includes('interventionId'));
  await writeFile(join(directory, `${phase}-${randomUUID()}.json`), JSON.stringify(receipt, null, 2), { mode: 0o600 });
  return receipt.receipt.result;
}
async function vnc(worker, config, taskId, ticket) {
  const query = new URLSearchParams(ticket);
  const web = new WebSocket(`ws://127.0.0.1:${config.operatorPort}/operator/tasks/${taskId}/vnc?${query}`, { headers: { Authorization: 'Bearer ' + worker.key } });
  let buffered = Buffer.alloc(0), phase = 'version', received = 0, closed = false, inspector, width, height, protocolFailure;
  web.on('close', () => { closed = true; inspector?.dispose(); }); web.on('error', () => {});
  web.on('message', bytes => {
    received += bytes.length;
    if (phase === 'pixels') { try { inspector.feed(bytes); } catch { protocolFailure = true; web.terminate(); } return; }
    buffered = Buffer.concat([buffered, bytes]);
    while (true) {
      if (phase === 'version' && buffered.length >= 12) { assert.match(buffered.subarray(0, 12).toString(), /^RFB/); buffered = buffered.subarray(12); web.send(Buffer.from('RFB 003.008\n')); phase = 'security'; }
      else if (phase === 'security' && buffered.length >= 2) {
        const count = buffered[0]; if (buffered.length < count + 1) return;
        assert.ok(buffered.subarray(1, count + 1).includes(1)); buffered = buffered.subarray(count + 1); web.send(Buffer.from([1])); phase = 'security-result';
      } else if (phase === 'security-result' && buffered.length >= 4) { assert.equal(buffered.readUInt32BE(0), 0); buffered = buffered.subarray(4); web.send(Buffer.from([1])); phase = 'server-init'; }
      else if (phase === 'server-init' && buffered.length >= 24) {
        const nameLength = buffered.readUInt32BE(20); if (buffered.length < 24 + nameLength) return;
        width = buffered.readUInt16BE(0); height = buffered.readUInt16BE(2);
        inspector = new RfbFixtureInspector({ pixelFormat: Buffer.from(buffered.subarray(4, 20)), width, height });
        const remainder = buffered.subarray(24 + nameLength);
        if (remainder.length) inspector.feed(remainder);
        buffered = Buffer.alloc(0); phase = 'pixels';
        const encodings = Buffer.from([2, 0, 0, 1, 0, 0, 0, 0]); web.send(encodings);
        const request = Buffer.alloc(10); request[0] = 3; request.writeUInt16BE(width, 6); request.writeUInt16BE(height, 8); web.send(request); return;
      } else return;
    }
  });
  await until(async () => { if (closed || protocolFailure) throw Error('Private VNC closed early'); return inspector?.reportFixtureHeader(); }, value => value?.complete, 10000);
  return { web,
    async inspectFixtureHeader() {
      const previous = inspector.reportFixtureHeader().frameNumber;
      const request = Buffer.alloc(10); request[0] = 3; request.writeUInt16BE(width, 6); request.writeUInt16BE(height, 8); web.send(request);
      return until(async () => { if (closed || protocolFailure) throw Error('Private VNC unavailable'); return inspector.reportFixtureHeader(); }, value => value.complete && value.frameNumber > previous, 10000);
    },
    get received() { return received; }, get closed() { return closed; } };
}
async function noCanary(path, canaries) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const filename = join(path, entry.name);
    if (entry.isDirectory()) await noCanary(filename, canaries);
    else if (entry.isFile() && (await lstat(filename)).size < 10 * 1024 * 1024) {
      const bytes = await readFile(filename); assert.ok(canaries.every(value => !bytes.includes(value)), 'Private test input persisted');
    }
  }
}
let active;
try {
  for (const name of values.cases.split(',')) {
    assert.ok(['baseline', 'private', 'cancel', 'recovery'].includes(name));
    const stateDirectory = join(directory, name);
    await mkdir(stateDirectory, { mode: 0o700 });
    const config = { ...template, stateDirectory, rpcSocket: join(dirname(template.rpcSocket), name, 'agent.sock') };
    const configFile = join(directory, name + '-worker.json');
    await monitor('/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginRequired: name === 'private', seed: synthetic ? 1 : name + '-' + randomUUID() }) });
    const state = await until(() => monitor(), value => value.view === 'home' && !value.cart.length && !value.events.length, 10000);
    // Give the fixture reset watcher time to replace the old browser document.
    await delay(3500);
    active = await start(config, configFile);
    const admitted = await delegation(active, config, 'start', { requestId: randomUUID(), desktopId: 'anonymous-chrome', goal: FIXTURE_GOAL, constraints: ['fixtureRunId=' + state.runId] });
    const taskId = admitted.taskId;
    const read = () => active.client.request('status', { taskId });
    let details = {}, privateInputs;
    if (name === 'private') {
      const waiting = await until(read, value => value.status === 'waiting_for_user' || ['failed', 'needs_review', 'reconciling'].includes(value.status));
      assert.equal(waiting.status, 'waiting_for_user');
      const privateStatus = await active.operator(taskId, 'status', {}, 'GET');
      const beforeCalls = (await records(stateDirectory)).length, beforeEvidence = (await readdir(join(stateDirectory, 'evidence'))).length;
      const connection = await vnc(active, config, taskId, privateStatus.ticket);
      const password = randomBytes(14).toString('hex'), otp = randomBytes(4).toString('hex');
      privateInputs = [password, otp];
      const action = action => active.operator(taskId, 'action', { ...privateStatus.ticket, action });
      // Focus the static test form without reading its private pixels or DOM.
      await action({ type: 'click', x: 640, y: 235 }); await action({ type: 'key', key: 'Tab' });
      await action({ type: 'type', text: password }); await action({ type: 'key', key: 'Tab' });
      await action({ type: 'type', text: otp }); await action({ type: 'key', key: 'Tab' }); await action({ type: 'key', key: 'Enter' });
      await until(() => monitor(), value => value.authenticated && !value.privacyRequired, 10000);
      await delay(750);
      const browserCheck = await connection.inspectFixtureHeader();
      assert.equal(browserCheck.passwordBubbleAbsent, true, 'Managed browser policy did not suppress the fixture password bubble');
      await action({ type: 'key', key: 'Escape' });
      await delay(250);
      await delay(1500);
      assert.equal((await records(stateDirectory)).length, beforeCalls);
      assert.equal((await readdir(join(stateDirectory, 'evidence'))).length, beforeEvidence);
      assert.equal((await read()).status, 'waiting_for_user');
      await noCanary(stateDirectory, [password, otp]);
      await noCanary(join(directory, 'pi'), [password, otp]);
      await active.operator(taskId, 'resume', privateStatus.ticket);
      await until(async () => connection.closed, Boolean, 5000);
      details = { privateModelAndEvidenceFrozen: true, publicFramesBeforePrivateInput: beforeEvidence, privateVncBytesReceivedWithoutRecording: connection.received, vncClosedOnResume: true, fixturePasswordBubbleRegressionProbe: browserCheck };
    } else if (name === 'cancel') {
      await until(() => records(stateDirectory), logs => logs.some(decisionStarted), 20000);
      const cancelled = await delegation(active, config, 'cancel', { taskId }); assert.equal(cancelled.status, 'cancelled');
      const snapshot = JSON.stringify(await read()); const before = (await records(stateDirectory)).length;
      await delay(2500); assert.equal(JSON.stringify(await read()), snapshot); assert.equal((await records(stateDirectory)).length, before);
      details = { noLateTaskChanges: true, noLaterModelRequests: true };
    } else if (name === 'recovery') {
      await until(() => records(stateDirectory), logs => logs.some(decisionStarted), 20000);
      const before = (await records(stateDirectory)).length;
      assert.equal((await read()).status, 'running');
      const beforeFixture = await monitor();
      const beforeEvidence = (await readdir(join(stateDirectory, 'evidence'))).length;
      await active.stop('SIGKILL'); active = await start(config, configFile);
      const interrupted = await read(); assert.equal(interrupted.status, 'interrupted');
      await delay(1500); assert.equal((await records(stateDirectory)).length, before);
      assert.deepEqual(await monitor(), beforeFixture);
      assert.equal((await readdir(join(stateDirectory, 'evidence'))).length, beforeEvidence);
      await delegation(active, config, 'resume', { taskId, expectedRevision: interrupted.revision });
      details = { killedWorkerRecoveredInterrupted: true, recoveryWindow: 'pending decision; no unconfirmed dispatch', externalFixtureAndEvidenceFrozenBeforeResume: true, noAutomaticReplay: true, explicitResume: true };
    }
    const final = name === 'cancel' ? await read() : await until(read, value => ['completed', 'failed', 'needs_review', 'reconciling'].includes(value.status));
    assert.equal(final.status, name === 'cancel' ? 'cancelled' : 'completed');
    const outcome = await delegation(active, config, 'result', { taskId });
    if (name !== 'cancel') assert.equal(outcome.verification.passed, true);
    const modelRecords = await records(stateDirectory);
    assert.ok(synthetic ? modelRecords.some(row => row.observedFrames === 1 && row.synthetic === true) : modelRecords.some(row => row.payloadImages === 1));
    report.cases.push({ name, taskId, status: final.status, details, verification: outcome.verification, evidenceRefs: outcome.evidenceRefs,
      visualWorker: synthetic ? { modelInference: false, controller: 'synthetic-fixed-fixture-plan', decisions: modelRecords.filter(decisionStarted).length, paidModelCalls: 0 } : { model: 'bailian/gpt-6-luna', requested: modelRecords.filter(row => row.event === 'request_started').length, completed: modelRecords.filter(row => row.event === 'request_completed').length, allCompletedRequestsCarryOneImage: modelRecords.filter(row => row.event === 'request_completed').every(row => row.payloadImages === 1) } });
    await active.stop(); active = undefined;
    if (privateInputs) {
      await noCanary(stateDirectory, privateInputs); await noCanary(join(directory, 'pi'), privateInputs);
      details.syntheticInputsAbsentFromFinalStateLogsAndCoordinator = true;
    }
    await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ case: name, status: final.status, workerMode: synthetic ? 'synthetic' : 'gpt-6-luna', decisions: synthetic ? report.cases.at(-1).visualWorker.decisions : report.cases.at(-1).visualWorker.requested }));
  }
  report.completedAt = new Date().toISOString();
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
} catch (error) {
  report.error = error.message;
  await writeFile(join(directory, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  throw error;
} finally { if (active) await active.stop().catch(() => {}); }
