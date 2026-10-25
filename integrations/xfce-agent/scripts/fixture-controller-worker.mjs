#!/usr/bin/env node
// Explicit test entry point. This controller does not demonstrate model vision.
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { startWorker } from '../src/main.mjs';
import { createFixtureMonitor } from '../src/driver.mjs';
if (process.argv.length !== 4 || process.argv[2] !== '--config') throw Error('Private --config required');
const config = JSON.parse(await readFile(process.argv[3], 'utf8'));
const monitor = createFixtureMonitor(config.fixtureEndpoint);
const tab = count => [...Array(count)].map(() => ({ type: 'key', key: 'Tab' }));
const enter = { type: 'key', key: 'Enter' };
const plans = {
  home: [{ type: 'click', x: 480, y: 100 }, { type: 'type', text: 'USB-C cable' }, enter],
  results: [...tab(6), enter], // The controlled seed places the eligible product second.
  detail: [...tab(6), enter],
  added: [...tab(4), enter],
  cart: [{ type: 'done' }],
};
const cursors = new Map();
const worker = await startWorker(process.argv[3], { createDecision: async ({ onRequest }) => async ({ task, frame, signal }) => {
  onRequest({ taskId: task.taskId, epoch: frame.epoch, event: 'synthetic_step', frameId: frame.id, observedFrames: 1, synthetic: true });
  await delay(350, undefined, { signal });
  const state = await monitor({ signal });
  const stage = state.view === 'detail' && state.cart.length ? 'added' : state.view;
  if (stage === 'login') throw Error('The test controller cannot handle private input');
  const key = task.taskId + ':' + frame.epoch;
  let cursor = cursors.get(key);
  if (cursor?.stage !== stage) { cursor = { stage, index: 0 }; cursors.set(key, cursor); }
  const plan = state.authenticated && ['detail', 'added'].includes(stage) ? [...tab(stage === 'detail' ? 5 : 3), enter] : plans[stage];
  const action = plan?.[cursor.index++];
  if (!action) throw Error('The synthetic fixture plan did not progress');
  return { frameId: frame.id, action, intent: 'Synthetic integration check; no model inference' };
} });
console.log(JSON.stringify({ ready: true, syntheticWorker: true, operatorPort: worker.server.operatorPort }));
const stop = async () => { try { await worker.close(); process.exitCode = 0; } catch { process.exitCode = 1; } };
process.once('SIGTERM', stop); process.once('SIGINT', stop);
