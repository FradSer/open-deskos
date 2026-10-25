import assert from 'node:assert/strict';
import { test } from 'node:test';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FIXTURE_GOAL, validateFixtureSubmission, validateFixtureRun, verifyFixture, createQmpDesktopDriver } from '../src/driver.mjs';
import { RELEASED_KEYS } from '../src/qmp.mjs';

function fixture() {
  const runId = randomUUID();
  const task = { goal: FIXTURE_GOAL, constraints: ['fixtureRunId=' + runId] };
  const state = { runId, privacyRequired: false, view: 'home', currency: 'USD', cart: [], events: [] };
  return { task, state };
}
test('Given a fixed task When admitted Then only a fresh named fixture run is accepted', () => {
  const { task, state } = fixture();
  validateFixtureSubmission(task, state);
  validateFixtureRun(task, state);
  assert.throws(() => validateFixtureRun(task, { ...state, runId: randomUUID() }), /run changed/);
  for (const altered of [{ ...task, goal: 'Book a flight' }, { ...task, constraints: [] }, { ...task, constraints: ['fixtureRunId=' + randomUUID()] }]) assert.throws(() => validateFixtureSubmission(altered, state));
  assert.throws(() => validateFixtureSubmission(task, { ...state, events: [{ type: 'search' }] }));
});
test('Given an existing matching cart When independently verified Then another task or run cannot claim success', () => {
  const { task, state } = fixture();
  Object.assign(state, { view: 'cart', cart: [{ length: '1m', connector: 'USB-C to USB-C', price: 11.99, quantity: 1 }], events: ['search', 'open_product', 'add_to_cart', 'open_cart'].map(type => ({ type })) });
  assert.equal(verifyFixture(state, task).passed, true);
  assert.equal(verifyFixture(state, { ...task, constraints: ['fixtureRunId=' + randomUUID()] }).passed, false);
  assert.equal(verifyFixture({ ...state, events: [] }, task).passed, false);
  assert.equal(verifyFixture({ ...state, events: [...state.events, { type: 'add_to_cart' }] }, task).passed, false);
});
test('Given QMP RESET When the VM generation changes Then no old action or capture can run', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'odk-qmp-'));
  const socketPath = join(directory, 'q.sock');
  const sent = []; let peer;
  const server = net.createServer(socket => {
    peer = socket; socket.write(JSON.stringify({ QMP: {} }) + '\r\n');
    let buffered = '';
    socket.on('data', bytes => {
      buffered += bytes;
      let end;
      while ((end = buffered.indexOf('\n')) >= 0) {
        const command = JSON.parse(buffered.slice(0, end)); buffered = buffered.slice(end + 1); sent.push(command);
        socket.write(JSON.stringify({ return: command.execute === 'query-qmp-schema' ? [{ name: 'QKeyCode', members: RELEASED_KEYS.map(name => ({ name })) }] : {}, id: command.id }) + '\r\n');
      }
    });
  });
  server.listen(socketPath); await once(server, 'listening');
  t.after(async () => { peer?.destroy(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const driver = await createQmpDesktopDriver({ qmpSocket: socketPath, fixtureEndpoint: 'http://127.0.0.1:1', captureDirectory: join(directory, 'capture') });
  const releaseCommands = sent.filter(command => command.execute === 'input-send-event');
  assert.ok(releaseCommands.every(command => command.arguments.events.length <= 16));
  const recovered = releaseCommands.flatMap(command => command.arguments.events);
  assert.ok(RELEASED_KEYS.includes('semicolon'));
  assert.ok(RELEASED_KEYS.every(key => recovered.some(event => event.data.key?.data === key)));
  const invalidated = new Promise(resolve => driver.onInvalidation(resolve));
  peer.write(JSON.stringify({ event: 'RESET' }) + '\r\n');
  await invalidated;
  const count = sent.length;
  await assert.rejects(driver.act({ type: 'click', x: 5, y: 5 }), /generation/);
  await assert.rejects(driver.capture(), /generation/);
  assert.equal(sent.length, count);
  await driver.close();
});
