import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { ppmToPng, createInputController } from '../src/qmp.mjs';

test('Given a binary QEMU frame When encoded Then PNG preserves dimensions and pixel bytes', () => {
  const pixels = Buffer.from([32, 10, 255, 0, 120, 1]);
  const result = ppmToPng(Buffer.concat([Buffer.from('P6\n# qemu\n2 1\n255\n'), pixels]));
  assert.equal(result.width, 2);
  assert.equal(result.height, 1);
  assert.equal(result.png.readUInt32BE(16), 2);
  assert.equal(result.png.readUInt32BE(20), 1);
  let offset = 8;
  const blocks = [];
  while (offset < result.png.length) {
    const length = result.png.readUInt32BE(offset);
    if (result.png.toString('ascii', offset + 4, offset + 8) === 'IDAT') blocks.push(result.png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  assert.deepEqual(inflateSync(Buffer.concat(blocks)), Buffer.concat([Buffer.from([0]), pixels]));
  assert.throws(() => ppmToPng(Buffer.from('P6\n100000 100000\n255\n')), /frame/i);
});

test('Given invalid input When dispatched Then no virtual input is sent', async () => {
  const calls = [];
  const input = createInputController({ command: async (...args) => calls.push(args), width: 1280, height: 800 });
  for (const action of [{ type: 'click', x: -1, y: 2 }, { type: 'click', x: 1280, y: 2 }, { type: 'key', key: 'Control+Alt+t' }, { type: 'type', text: 'word\n' }]) {
    await assert.rejects(input.act(action), /unsupported|invalid/i);
  }
  assert.equal(calls.length, 0);
});

test('Given cancellation after key down When input stops Then the key is released', async () => {
  const abort = new AbortController();
  const events = [];
  const input = createInputController({ width: 1280, height: 800, command: async (name, args) => {
    events.push(...(args.events ?? []));
    if (events.some(event => event.type === 'key' && event.data.down)) abort.abort();
  } });
  await assert.rejects(input.act({ type: 'type', text: 'A' }, { signal: abort.signal }));
  assert.ok(events.some(event => event.type === 'key' && event.data.down));
  const downs = events.filter(event => event.type === 'key' && event.data.down).map(event => event.data.key.data);
  const ups = events.filter(event => event.type === 'key' && !event.data.down).map(event => event.data.key.data);
  for (const key of downs) assert.ok(ups.includes(key), key);
});

test('Given an unconfirmed key release When retried Then held input is retained and new actions stay fenced', async () => {
  const sent = []; let rejectRelease = true;
  const input = createInputController({ width: 1280, height: 800, command: async (_name, args) => {
    sent.push(args.events);
    if (rejectRelease && args.events.some(event => event.type === 'key' && !event.data.down)) throw Error('QMP unavailable');
  } });
  await assert.rejects(input.act({ type: 'type', text: 'A' }), /QMP/);
  const count = sent.length;
  await assert.rejects(input.act({ type: 'click', x: 3, y: 4 }), /release/i);
  assert.equal(sent.length, count);
  rejectRelease = false;
  await input.release();
  assert.deepEqual(sent.at(-1).map(event => event.data.key.data), ['a', 'shift']);
  await input.act({ type: 'click', x: 3, y: 4 });
});

test('Given a failed mouse release When retried Then the same button-up is sent', async () => {
  const sent = []; let rejectRelease = true;
  const input = createInputController({ width: 1280, height: 800, command: async (_name, args) => {
    sent.push(args.events);
    if (rejectRelease && args.events.some(event => event.type === 'btn' && !event.data.down)) throw Error('QMP unavailable');
  } });
  await assert.rejects(input.act({ type: 'click', x: 3, y: 4 }), /QMP/);
  rejectRelease = false;
  const count = sent.length;
  await input.release();
  assert.equal(sent.length, count + 1);
  assert.deepEqual(sent.at(-1), [{ type: 'btn', data: { button: 'left', down: false } }]);
});

test('Given a polled virtual USB mouse When a click is sent Then the guest observes its down state before release', async () => {
  let pressed = false, observed = false;
  const input = createInputController({ width: 1280, height: 800, command: async (_name, args) => {
    for (const event of args.events) if (event.type === 'btn' && event.data.button === 'left') {
      pressed = event.data.down;
      if (pressed) setTimeout(() => { if (pressed) observed = true; }, 20);
    }
  } });
  await input.act({ type: 'click', x: 4, y: 5 });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(observed, true);
  assert.equal(pressed, false);
});
