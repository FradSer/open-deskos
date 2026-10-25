import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { setTimeout as delay } from 'node:timers/promises';

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  const content = Buffer.concat([name, data]);
  let crc = 0xffffffff;
  for (const byte of content) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const output = Buffer.alloc(data.length + 12);
  output.writeUInt32BE(data.length);
  content.copy(output, 4);
  output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, output.length - 4);
  return output;
}

/** Encode the actual QEMU framebuffer without a host graphics dependency. */
export function ppmToPng(bytes) {
  let offset = 0;
  const token = () => {
    while (offset < bytes.length) {
      if (bytes[offset] === 35) { while (offset < bytes.length && bytes[offset] !== 10) offset++; }
      else if ([9, 10, 13, 32].includes(bytes[offset])) offset++;
      else break;
    }
    const start = offset;
    while (offset < bytes.length && ![9, 10, 13, 32].includes(bytes[offset])) offset++;
    return bytes.toString('ascii', start, offset);
  };
  if (token() !== 'P6') throw Error('Invalid QEMU frame');
  const width = Number(token());
  const height = Number(token());
  const maximum = Number(token());
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 2160 || maximum !== 255) throw Error('Invalid QEMU frame dimensions');
  if (bytes[offset] === 13 && bytes[offset + 1] === 10) offset += 2;
  else offset++;
  if (bytes.length - offset !== width * height * 3) throw Error('Invalid QEMU frame length');
  const scanlines = Buffer.alloc(height * (width * 3 + 1));
  for (let row = 0; row < height; row++) bytes.copy(scanlines, row * (width * 3 + 1) + 1, offset + row * width * 3, offset + (row + 1) * width * 3);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return { width, height, png: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]) };
}

/** Connect only to the operator-selected local QMP socket. */
export async function connectQmp(socketPath, { timeoutMs = 10000, onEvent } = {}) {
  const socket = net.createConnection({ path: socketPath });
  const pending = new Map();
  let buffered = '';
  let greeted;
  let rejectGreeting;
  const greeting = new Promise((resolve, reject) => { greeted = resolve; rejectGreeting = reject; });
  const fail = () => {
    rejectGreeting(Error('QMP connection unavailable'));
    for (const entry of pending.values()) entry.reject(Error('QMP command interrupted'));
    pending.clear();
  };
  socket.on('error', fail);
  socket.on('close', () => { fail(); onEvent?.('DISCONNECTED'); });
  socket.on('data', bytes => {
    buffered += bytes.toString('utf8');
    if (buffered.length > 1024 * 1024) { socket.destroy(); return; }
    let newline;
    while ((newline = buffered.indexOf('\n')) >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      let response;
      try { response = JSON.parse(line); } catch { socket.destroy(); return; }
      if (response.QMP) greeted();
      if (response.event) onEvent?.(response.event);
      const entry = pending.get(response.id);
      if (entry) {
        pending.delete(response.id);
        if (response.error) entry.reject(Error('QMP command rejected'));
        else entry.resolve(response.return);
      }
    }
  });
  const command = async (name, args = {}) => {
    if (socket.destroyed) throw Error('QMP connection unavailable');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { pending.delete(id); reject(Error('QMP command deadline exceeded')); }, timeoutMs);
      const finish = callback => value => { clearTimeout(timeout); callback(value); };
      pending.set(id, { resolve: finish(resolve), reject: finish(reject) });
      socket.write(JSON.stringify({ execute: name, arguments: args, id }) + '\n', error => {
        if (error) { pending.get(id)?.reject(Error('QMP write failed')); pending.delete(id); }
      });
    });
  };
  const greetingTimeout = setTimeout(() => socket.destroy(), timeoutMs);
  try { await greeting; await command('qmp_capabilities'); }
  catch (error) { socket.destroy(); throw error; }
  finally { clearTimeout(greetingTimeout); }
  return { command, close: () => { socket.destroy(); } };
}

const characters = {
  ' ': ['spc'], '-': ['minus'], '_': ['shift', 'minus'], '=': ['equal'], '+': ['shift', 'equal'],
  '.': ['dot'], ',': ['comma'], '/': ['slash'], '?': ['shift', 'slash'], ':': ['shift', 'semicolon'],
  ';': ['semicolon'], "'": ['apostrophe'], '"': ['shift', 'apostrophe'], '@': ['shift', '2'],
  '!': ['shift', '1'], '#': ['shift', '3'], '$': ['shift', '4'], '%': ['shift', '5'],
  '&': ['shift', '7'], '*': ['shift', '8'], '(': ['shift', '9'], ')': ['shift', '0'],
  '[': ['bracket_left'], ']': ['bracket_right'], '\\': ['backslash'],
};
const shortcuts = { Enter: ['ret'], Tab: ['tab'], Escape: ['esc'], Backspace: ['backspace'], 'Control+a': ['ctrl', 'a'] };

export const RELEASED_KEYS = [...new Set([...'abcdefghijklmnopqrstuvwxyz0123456789', ...Object.values(characters).flat(), ...Object.values(shortcuts).flat(), 'alt', 'alt_r', 'ctrl_r', 'shift_r', 'meta_l', 'meta_r'])];

export function createInputController({ command, width, height }) {
  const held = new Set();
  const buttons = new Set();
  const keyEvent = (key, down) => ({ type: 'key', data: { down, key: { type: 'qcode', data: key } } });
  const send = events => command('input-send-event', { events });
  async function release() {
    const events = [...held].reverse().map(key => keyEvent(key, false));
    events.push(...[...buttons].map(button => ({ type: 'btn', data: { button, down: false } })));
    if (events.length) await send(events);
    held.clear(); buttons.clear();
  }
  async function press(keys, signal) {
    try {
      for (const key of keys) {
        signal?.throwIfAborted(); held.add(key); await send([keyEvent(key, true)]);
      }
      await delay(25, undefined, { signal });
      signal?.throwIfAborted();
    } finally { await release(); }
    await delay(10, undefined, { signal });
  }
  const textKeys = text => [...text].map(character => characters[character] ?? (/^[a-z0-9]$/.test(character) ? [character] : /^[A-Z]$/.test(character) ? ['shift', character.toLowerCase()] : null));
  async function act(action, { signal } = {}) {
    signal?.throwIfAborted();
    if (held.size || buttons.size) throw Error('Input release is unconfirmed');
    if (action.type === 'click') {
      if (![action.x, action.y].every(Number.isInteger) || action.x < 0 || action.y < 0 || action.x >= width || action.y >= height) throw Error('Invalid screenshot coordinates');
      await send([{ type: 'abs', data: { axis: 'x', value: Math.round(action.x * 32767 / (width - 1)) } }, { type: 'abs', data: { axis: 'y', value: Math.round(action.y * 32767 / (height - 1)) } }]);
      try {
        signal?.throwIfAborted(); buttons.add('left'); await send([{ type: 'btn', data: { button: 'left', down: true } }]);
        await delay(50, undefined, { signal });
        signal?.throwIfAborted();
      } finally { await release(); }
    } else if (action.type === 'type') {
      if (typeof action.text !== 'string' || !action.text || action.text.length > 160) throw Error('Invalid focused text');
      const sequence = textKeys(action.text);
      if (sequence.some(keys => !keys)) throw Error('Unsupported text character');
      for (const keys of sequence) await press(keys, signal);
    } else if (action.type === 'key') {
      if (!shortcuts[action.key]) throw Error('Unsupported shortcut');
      await press(shortcuts[action.key], signal);
    } else if (action.type === 'scroll') {
      if (!Number.isInteger(action.dy) || Math.abs(action.dy) > 700 || action.dy === 0) throw Error('Invalid scroll');
      const button = action.dy > 0 ? 'wheel-down' : 'wheel-up';
      for (let index = 0; index < Math.ceil(Math.abs(action.dy) / 120); index++) {
        signal?.throwIfAborted(); buttons.add(button);
        try { await send([{ type: 'btn', data: { button, down: true } }]); } finally { await release(); }
      }
    } else if (action.type === 'wait') {
      if (!Number.isInteger(action.ms) || action.ms < 100 || action.ms > 3000) throw Error('Invalid wait');
      await delay(action.ms, undefined, { signal });
    } else throw Error('Unsupported desktop action');
  }
  return { act, release };
}
