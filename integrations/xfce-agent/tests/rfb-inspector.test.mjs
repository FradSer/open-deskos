import test from 'node:test';
import assert from 'node:assert/strict';
import { RfbFixtureInspector } from '../scripts/lib/rfb-inspector.mjs';

const width = 1280, height = 800;
function format(bigEndian = false, shifts = [16, 8, 0]) {
  const bytes = Buffer.alloc(16); bytes[0] = 32; bytes[1] = 24; bytes[2] = Number(bigEndian); bytes[3] = 1;
  for (const offset of [4, 6, 8]) bytes.writeUInt16BE(255, offset);
  shifts.forEach((shift, index) => { bytes[10 + index] = shift; }); return bytes;
}
function rectangle({ x = 0, y = 0, w = width, h = height, encoding = 0, color = [23, 45, 62], bigEndian = false, shifts = [16, 8, 0] } = {}) {
  const bytes = Buffer.alloc(12 + w * h * 4); bytes.writeUInt16BE(x, 0); bytes.writeUInt16BE(y, 2); bytes.writeUInt16BE(w, 4); bytes.writeUInt16BE(h, 6); bytes.writeInt32BE(encoding, 8);
  const value = color.reduce((value, channel, index) => (value | (channel << shifts[index])) >>> 0, 0);
  for (let offset = 12; offset < bytes.length; offset += 4) bigEndian ? bytes.writeUInt32BE(value, offset) : bytes.writeUInt32LE(value, offset);
  return bytes;
}
const update = rectangles => { const head = Buffer.from([0, 0, 0, 0]); head.writeUInt16BE(rectangles.length, 2); return Buffer.concat([head, ...rectangles]); };
const inspector = options => new RfbFixtureInspector({ pixelFormat: format(), width, height, ...options });

test('Given a fragmented raw framebuffer When every pixel arrives Then only fixed-fixture metadata is exposed', () => {
  const probe = inspector(), bytes = update([rectangle()]);
  assert.deepEqual(probe.reportFixtureHeader(), { frameNumber: 0, complete: false, passwordBubbleAbsent: false });
  for (let offset = 0; offset < bytes.length; offset += 4093) {
    probe.feed(bytes.subarray(offset, Math.min(offset + 4093, bytes.length)));
    if (offset + 4093 < bytes.length) assert.equal(probe.reportFixtureHeader().complete, false);
  }
  assert.deepEqual(probe.reportFixtureHeader(), { frameNumber: 1, complete: true, passwordBubbleAbsent: true });
  assert.equal(JSON.stringify(probe), '{}'); assert.deepEqual(Object.keys(probe.reportFixtureHeader()).sort(), ['complete', 'frameNumber', 'passwordBubbleAbsent']);
  assert.equal(probe.rgb, undefined); assert.equal(probe.pixels, undefined); assert.equal(probe.png, undefined);
});

test('Given an earlier dark frame When a fresh white password bubble arrives Then the new frame cannot reuse its earlier verdict', () => {
  const probe = inspector(); probe.feed(update([rectangle()]));
  const next = update([rectangle({ color: [255, 255, 255] })]);
  probe.feed(next.subarray(0, 100)); assert.equal(probe.reportFixtureHeader().complete, false);
  probe.feed(next.subarray(100));
  assert.deepEqual(probe.reportFixtureHeader(), { frameNumber: 2, complete: true, passwordBubbleAbsent: false });
});

test('Given only header points or overlapping rectangles When an update ends Then coverage cannot be mistaken for a full snapshot', () => {
  const probe = inspector(); probe.feed(update([rectangle({ x: 800, y: 60, w: 400, h: 10 })]));
  assert.deepEqual(probe.reportFixtureHeader(), { frameNumber: 1, complete: false, passwordBubbleAbsent: false });
  probe.feed(update([rectangle({ h: 400 }), rectangle({ h: 400 })])); assert.equal(probe.reportFixtureHeader().complete, false);
  probe.feed(update([rectangle({ h: 400 }), rectangle({ y: 400, h: 400 })])); assert.equal(probe.reportFixtureHeader().complete, true);
});

for (const bigEndian of [false, true]) test(`Given true-color ${bigEndian ? 'big' : 'little'} endian pixels When channel shifts change Then the dark header is decoded`, () => {
  const shifts = [0, 16, 8], probe = inspector({ pixelFormat: format(bigEndian, shifts) });
  probe.feed(update([rectangle({ bigEndian, shifts })])); assert.equal(probe.reportFixtureHeader().passwordBubbleAbsent, true);
});

test('Given Bell and clipboard data When fragmented content is skipped Then no clipboard fields are retained or exposed', () => {
  const probe = inspector(), canary = Buffer.from('synthetic-private-clipboard');
  const clipboard = Buffer.alloc(8); clipboard[0] = 3; clipboard.writeUInt32BE(canary.length, 4);
  const bytes = Buffer.concat([Buffer.from([2]), clipboard, canary, update([rectangle()])]);
  for (let offset = 0; offset < bytes.length; offset += 8191) probe.feed(bytes.subarray(offset, offset + 8191));
  assert.equal(probe.reportFixtureHeader().complete, true); assert.ok(!JSON.stringify(probe).includes(canary.toString()));
  assert.ok(!JSON.stringify(probe.reportFixtureHeader()).includes(canary.toString()));
});

test('Given invalid dimensions or pixel layouts When creating a probe Then it refuses unsupported memory contracts', () => {
  assert.throws(() => inspector({ width: 8192 }));
  for (const offset of [0, 1, 2, 3, 4, 10]) { const bytes = format(); bytes[offset] = 7; assert.throws(() => inspector({ pixelFormat: bytes })); }
  assert.throws(() => inspector({ pixelFormat: Buffer.alloc(8) }));
});

test('Given unsupported messages, encodings, or out-of-bounds rectangles When feeding Then the probe fails closed and erases its valid verdict', () => {
  for (const bytes of [Buffer.from([1]), update([rectangle({ encoding: 5, w: 1, h: 1 })]), update([rectangle({ x: width, w: 1, h: 1 })])]) {
    const probe = inspector(); probe.feed(update([rectangle()])); assert.throws(() => probe.feed(bytes));
    assert.equal(probe.reportFixtureHeader().complete, false); assert.throws(() => probe.feed(Buffer.from([2])));
  }
});

test('Given stream, clipboard, rectangle-count or update budgets are exceeded When feeding Then no allocation beyond the limits is accepted', () => {
  assert.throws(() => inspector().feed(Buffer.alloc(8 * 1024 * 1024 + 1)));
  const clipboard = Buffer.alloc(8); clipboard[0] = 3; clipboard.writeUInt32BE(8 * 1024 * 1024 + 1, 4); assert.throws(() => inspector().feed(clipboard));
  const count = Buffer.from([0, 0, 1, 1]); assert.throws(() => inspector().feed(count));
  const probe = inspector(); probe.feed(update([rectangle(), rectangle()]).subarray(0, 4 + 12 + width * height * 4));
  // Three advertised full rectangles exceed the per-update cap at their headers.
  const third = inspector(), bytes = update([rectangle(), rectangle(), rectangle()]);
  for (let offset = 0; offset < 4 + (12 + width * height * 4) * 2; offset += 1024 * 1024) third.feed(bytes.subarray(offset, Math.min(offset + 1024 * 1024, 4 + (12 + width * height * 4) * 2)));
  assert.throws(() => third.feed(bytes.subarray(4 + (12 + width * height * 4) * 2, 4 + (12 + width * height * 4) * 2 + 12)));
});
