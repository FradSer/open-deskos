import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connectQmp, createInputController, ppmToPng, RELEASED_KEYS } from './qmp.mjs';

export const FIXTURE_GOAL = 'Find a 1 metre USB-C to USB-C cable costing at most USD 15. Add exactly one to the cart, verify it, and do not order.';
const runId = task => task?.constraints?.[0]?.match(/^fixtureRunId=([a-f0-9-]{36})$/i)?.[1];
export function validateFixtureRun(task, state) {
  if (runId(task) !== state.runId) throw Error('The fixture run changed; no input can be replayed.');
}
export function validateFixtureSubmission(task, state) {
  if (task.goal !== FIXTURE_GOAL || task.constraints?.length !== 1 || !runId(task) || runId(task) !== state.runId || state.view !== 'home' || state.privacyRequired || state.cart.length || state.events?.length) throw Error('Only a fresh anonymous fixture cable task is supported.');
}

/** Read only the operator-configured synthetic fixture monitor. */
export function createFixtureMonitor(endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.search || url.hash) throw Error('Invalid anonymous fixture endpoint');
  return async ({ signal } = {}) => {
    const response = await fetch(new URL('/state', url), { signal: AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]), redirect: 'error' });
    if (!response.ok) throw Error('Fixture monitor unavailable');
    const reader = response.body.getReader();
    let bytes = 0; const parts = [];
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        bytes += result.value.length;
        if (bytes > 32768) throw Error('Fixture monitor response exceeds its limit');
        parts.push(result.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const state = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!state || typeof state.privacyRequired !== 'boolean' || !Array.isArray(state.cart) || typeof state.view !== 'string') throw Error('Fixture monitor returned invalid state');
    return state;
  };
}

export function verifyFixture(state, task) {
  const item = state.cart.length === 1 ? state.cart[0] : undefined;
  const checks = [
    { requirement: 'This task names the current fixture run', passed: task?.goal === FIXTURE_GOAL && runId(task) === state.runId },
    { requirement: 'This run records search, product inspection and cart inspection', passed: ['search', 'open_product', 'open_cart'].every(type => state.events?.some(event => event.type === type)) },
    { requirement: 'This run records exactly one cart addition', passed: state.events?.filter(event => event.type === 'add_to_cart').length === 1 },
    { requirement: 'The browser displays its cart', passed: state.view === 'cart' },
    { requirement: 'The cart has one product', passed: state.cart.length === 1 },
    { requirement: 'The selected cable is one metre', passed: ['1m', '1 m'].includes(item?.length) },
    { requirement: 'Both connectors are USB-C', passed: /^(?:USB-C to USB-C|C-C|usb-c-to-usb-c)$/i.test(item?.connector ?? '') },
    { requirement: 'Unit price does not exceed USD 15', passed: Number.isFinite(item?.price) && item.price > 0 && item.price <= 15 && state.currency === 'USD' },
    { requirement: 'Quantity is one', passed: item?.quantity === 1 },
    { requirement: 'The browser is outside private mode', passed: state.privacyRequired === false },
  ];
  return { passed: checks.every(check => check.passed), checks, summary: checks.every(check => check.passed) ? 'The anonymous fixture cart contains one matching USB-C cable. No order was placed.' : 'The fixture cart does not establish every requested outcome.' };
}

/** QMP and VNC observe the same QEMU display. No DOM enters the model input. */
export async function createQmpDesktopDriver({ qmpSocket, fixtureEndpoint, captureDirectory, width = 1280, height = 800 }) {
  let invalid = false, closing = false;
  const listeners = new Set();
  const valid = () => { if (invalid) throw Error('Virtual machine generation is unavailable'); };
  const qmp = await connectQmp(qmpSocket, { onEvent: event => {
    if (closing || invalid || !['RESET', 'SHUTDOWN', 'STOP', 'DISCONNECTED'].includes(event)) return;
    invalid = true;
    for (const listener of listeners) { try { listener(event); } catch { /* The driver remains fenced. */ } }
  } });
  try {
  const input = createInputController({ command: qmp.command, width, height });
  const monitor = createFixtureMonitor(fixtureEndpoint);
  await mkdir(captureDirectory, { recursive: true, mode: 0o700 });
  const schema = await qmp.command('query-qmp-schema');
  const keyEnum = schema.find(entry => {
    const values = entry.members?.map(member => member.name) ?? entry.values;
    return Array.isArray(values) && RELEASED_KEYS.every(key => values.includes(key));
  });
  const allKeys = keyEnum?.members?.map(member => member.name) ?? keyEnum?.values;
  if (!Array.isArray(allKeys) || !RELEASED_KEYS.every(key => allKeys.includes(key))) { qmp.close(); throw Error('The VM keyboard contract is unavailable'); }
  // Recover a possibly held key after a killed worker without replaying input.
  async function releaseAll() {
    await input.release();
    const events = [
      ...allKeys.filter(key => key !== 'unmapped').map(key => ({ type: 'key', data: { down: false, key: { type: 'qcode', data: key } } })),
      ...['left', 'middle', 'right', 'wheel-up', 'wheel-down', 'side', 'extra'].map(button => ({ type: 'btn', data: { down: false, button } })),
    ];
    for (let offset = 0; offset < events.length; offset += 16) {
      await qmp.command('input-send-event', { events: events.slice(offset, offset + 16) });
      if (offset + 16 < events.length) await delay(10);
    }
  }
  await releaseAll();
  return {
    onInvalidation(listener) { listeners.add(listener); if (invalid) listener('INVALIDATED'); return () => listeners.delete(listener); },
    async validateSubmission(task) { valid(); validateFixtureSubmission(task, await monitor()); valid(); },
    async guard(context) { valid(); const state = await monitor(context); valid(); if (context?.task) validateFixtureRun(context.task, state); return { privacyRequired: state.privacyRequired }; },
    async capture({ signal } = {}) {
      valid();
      signal?.throwIfAborted();
      const temporary = await mkdtemp(join(captureDirectory, 'frame-'));
      try {
        const filename = join(temporary, 'display.ppm');
        await qmp.command('screendump', { filename });
        signal?.throwIfAborted();
        const frame = ppmToPng(await readFile(filename));
        valid();
        if (frame.width !== width || frame.height !== height) throw Error('Virtual desktop geometry changed');
        return frame;
      } finally { await rm(temporary, { recursive: true, force: true }); }
    },
    async act(action, context) { valid(); if (context?.task) { validateFixtureRun(context.task, await monitor(context)); valid(); } await input.act(action, context); await delay(180); valid(); },
    release: releaseAll,
    async verify(context) { valid(); const state = await monitor(context); valid(); return verifyFixture(state, context?.task); },
    async inspect(context) { valid(); const state = await monitor(context); valid(); return state; },
    async close() { closing = true; try { await releaseAll(); } finally { qmp.close(); } },
  };
  } catch (error) { closing = true; qmp.close(); throw error; }
}
