import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { startDesktopServer } from '../src/server.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'xfce-server-'));
  const taskId = randomUUID(), oldTaskId = randomUUID(), token = 'a'.repeat(48);
  let status = 'waiting_for_user', revision = 3, releases = 0, invalidate;
  const ticket = { interventionId: randomUUID(), expectedRevision: revision };
  const vncSocket = join(directory, 'vnc.sock'), rpcSocket = join(directory, 'rpc.sock');
  const streams = new Set();
  const vnc = net.createServer(stream => { streams.add(stream); stream.on('close', () => streams.delete(stream)); stream.on('data', data => stream.write(data)); });
  vnc.listen(vncSocket); await once(vnc, 'listening');
  const assets = join(directory, 'assets'); await mkdir(join(assets, 'core'), { recursive: true });
  await writeFile(join(assets, 'core', 'rfb.js'), 'export default class RFB {}');
  const runtime = {
    async status(id) { if (id === oldTaskId) return { taskId: id, status: 'completed', revision: 9 }; if (id !== taskId) throw Error('Unknown task'); return { taskId, status, revision }; },
    async result() { return { summary: overrides.summary ?? 'Synthetic result' }; },
    async getPrivateTicket(id) { if (id !== taskId || status !== 'waiting_for_user') throw Error('No private ticket'); return { ...ticket }; },
    async resume() { await overrides.transition?.(); status = 'running'; revision++; return { taskId, status, revision }; },
    async cancel(id) { if (id !== taskId) throw Error('Wrong task'); await overrides.transition?.(); status = 'cancelled'; revision++; return { taskId, status, revision }; },
    async pause() { status = 'waiting_for_user'; return { taskId, status, revision }; },
  };
  const driver = { async release() { releases++; await overrides.release?.(); }, async inspect() { return { privacyRequired: false }; }, async act() {}, onInvalidation(handler) { invalidate = handler; return () => { invalidate = undefined; }; } };
  const server = await startDesktopServer({ runtime, driver, rpcSocket, vncSocket, operatorKey: token, assetsDirectory: assets, operatorHtml: new URL('../web/operator.html', import.meta.url) });
  const origin = 'http://127.0.0.1:' + server.operatorPort;
  const auth = { Authorization: 'Bearer ' + token, Origin: origin };
  const request = (path, value, headers = auth) => fetch(origin + path, { method: value === undefined ? 'GET' : 'POST', headers: { ...headers, ...(value === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
  const rpc = value => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: rpcSocket, path: '/rpc', method: 'POST', headers: { 'Content-Type': 'application/json' } }, response => {
      const chunks = []; response.on('data', c => chunks.push(c)); response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks))));
    }); req.on('error', reject); req.end(JSON.stringify(value));
  });
  const connect = (boundTicket = ticket) => new WebSocket(origin.replace('http:', 'ws:') + '/operator/tasks/' + taskId + '/vnc?' + new URLSearchParams({ interventionId: boundTicket.interventionId, expectedRevision: String(boundTicket.expectedRevision) }), { headers: auth });
  t.after(async () => { overrides.cleanup?.(); try { await server.close(); } catch (error) { if (!overrides.closeMayFail) throw error; } finally { for (const stream of streams) stream.destroy(); await new Promise(r => vnc.close(r)); await rm(directory, { recursive: true, force: true }); } });
  return { request, rpc, connect, taskId, oldTaskId, ticket, origin, token, assets, directory, rpcSocket, close: () => server.close(), releases: () => releases, setStatus: value => { status = value; }, invalidate: () => invalidate?.(), sendPixels: async bytes => { if (!streams.size) await once(vnc, 'connection'); for (const stream of streams) stream.write(bytes); } };
}
async function opened(web) { await once(web, 'open'); web.on('error', () => {}); return web; }
async function rejected(web) {
  return new Promise(resolve => { web.on('unexpected-response', (_request, response) => { response.resume(); web.terminate(); resolve(response.statusCode); }); web.on('error', () => {}); web.on('open', () => { web.terminate(); resolve(101); }); });
}

test('Given no session When loading the operator Then its login script loads and cookie-authorized noVNC assets share its path', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/operator/app.js', undefined, {})).status, 200);
  const login = await f.request('/operator/session', { token: f.token }, { Origin: f.origin });
  const cookie = login.headers.get('set-cookie'); assert.match(cookie, /Path=\/operator(?:;|$)/);
  const asset = await f.request('/operator/novnc/core/rfb.js', undefined, { Cookie: cookie.split(';')[0], Origin: f.origin });
  assert.equal(asset.status, 200); assert.match(await asset.text(), /class RFB/);
  const script = await (await f.request('/operator/app.js', undefined, {})).text(); assert.match(script, /\/operator\/novnc\/core\/rfb\.js/);
});

test('Given a multibyte response When its UTF-8 bytes exceed the limit Then RPC refuses the response', async t => {
  const f = await fixture(t, { summary: '界'.repeat(50000) });
  const result = await f.rpc({ method: 'result', params: { taskId: f.taskId } });
  assert.equal(result.ok, false); assert.equal(result.error.code, 'response_too_large');
});

test('Given private VNC When cancel addresses an unknown or completed task Then the active session remains connected', async t => {
  const f = await fixture(t), web = await opened(f.connect());
  for (const taskId of [randomUUID(), f.oldTaskId]) {
    assert.equal((await f.rpc({ method: 'cancel', params: { taskId } })).ok, false);
    assert.equal((await (await f.request('/operator/tasks/' + taskId + '/cancel', {})).json()).ok, false);
  }
  assert.equal(f.releases(), 0); assert.equal(web.readyState, WebSocket.OPEN);
  const received = once(web, 'message'); web.send('synthetic input'); assert.equal(String((await received)[0]), 'synthetic input'); web.terminate();
});

for (const method of ['resume', 'cancel']) test(`Given a private transition When ${method} drains and commits Then new VNC is refused throughout and the old connection closes`, async t => {
  const draining = deferred(), drainStarted = deferred(), commit = deferred(), commitStarted = deferred();
  let firstRelease = true;
  const f = await fixture(t, { release: async () => { if (firstRelease) { firstRelease = false; drainStarted.resolve(); await draining.promise; } }, transition: async () => { commitStarted.resolve(); await commit.promise; }, cleanup: () => { draining.resolve(); commit.resolve(); } });
  const web = await opened(f.connect()); const closed = once(web, 'close');
  const changing = f.request('/operator/tasks/' + f.taskId + '/' + method, method === 'resume' ? f.ticket : {});
  await drainStarted.promise; await closed;
  assert.equal(await rejected(f.connect()), 403);
  draining.resolve(); await commitStarted.promise;
  assert.equal(await rejected(f.connect()), 403);
  commit.resolve(); assert.equal((await (await changing).json()).ok, true);
  assert.equal(await rejected(f.connect()), 403);
});

test('Given an obsolete intervention When opening VNC Then the bound ticket is rejected', async t => {
  const f = await fixture(t);
  assert.equal(await rejected(f.connect({ ...f.ticket, interventionId: randomUUID() })), 403);
});

test('Given an established VNC session When private authorization disappears Then further pixels and input are fenced', async t => {
  const f = await fixture(t), web = await opened(f.connect());
  const closed = once(web, 'close'); f.setStatus('interrupted'); web.send('stale input'); await closed;
  assert.equal(web.readyState, WebSocket.CLOSED);
});

test('Given a VM invalidation When private VNC is open Then transport closes and every later request is refused', async t => {
  const f = await fixture(t), web = await opened(f.connect());
  const closed = once(web, 'close'); f.invalidate(); await closed;
  assert.equal((await f.request('/operator/tasks/' + f.taskId + '/status')).status, 403);
  assert.equal((await f.rpc({ method: 'status', params: { taskId: f.taskId } })).ok, false);
  assert.equal(await rejected(f.connect()), 403);
});

test('Given a stale resume ticket When another private client is connected Then refusal leaves the valid intervention intact', async t => {
  const f = await fixture(t), web = await opened(f.connect());
  const response = await f.request('/operator/tasks/' + f.taskId + '/resume', { ...f.ticket, interventionId: randomUUID() });
  assert.equal((await response.json()).ok, false); assert.equal(f.releases(), 0); assert.equal(web.readyState, WebSocket.OPEN); web.terminate();
});

test('Given private authorization disappears When a VNC frame arrives Then its pixels are not forwarded', async t => {
  const f = await fixture(t), web = await opened(f.connect());
  let pixels = 0; web.on('message', () => { pixels++; });
  const closed = once(web, 'close'); f.setStatus('interrupted'); await f.sendPixels(Buffer.from('private synthetic pixels')); await closed;
  assert.equal(pixels, 0);
});

test('Given a task RPC client When low-level input or private resume is requested Then no operator capability is exposed', async t => {
  const f = await fixture(t);
  for (const method of ['action', 'screenshot', 'pause', 'reconcile', 'getPrivateTicket']) assert.equal((await f.rpc({ method, params: { taskId: f.taskId } })).ok, false);
  assert.equal((await f.rpc({ method: 'resume', params: { taskId: f.taskId, expectedRevision: f.ticket.expectedRevision } })).ok, false);
  assert.equal((await f.request('/operator/tasks/' + f.taskId + '/status', undefined, {})).status, 403);
  assert.equal((await f.request('/operator/tasks/' + f.taskId + '/status', undefined, { Authorization: 'Bearer ' + f.token, Origin: 'http://untrusted.invalid' })).status, 403);
});

test('Given an asset symlink outside the noVNC root When an authenticated client reads it Then the file is refused', async t => {
  const f = await fixture(t); await writeFile(join(f.directory, 'outside.js'), 'outside synthetic asset'); await symlink(join(f.directory, 'outside.js'), join(f.assets, 'core', 'outside.js'));
  assert.notEqual((await f.request('/operator/novnc/core/outside.js')).status, 200);
});

test('Given input release fails When the server closes Then both listeners and the owned socket still close', async t => {
  const f = await fixture(t, { release: async () => { throw Error('Synthetic QMP disconnect'); }, closeMayFail: true });
  const web = await opened(f.connect()), closed = once(web, 'close');
  await assert.rejects(f.close(), /Synthetic QMP disconnect/); await closed;
  await assert.rejects(lstat(f.rpcSocket), { code: 'ENOENT' });
  await assert.rejects(fetch(f.origin + '/operator'));
  await assert.rejects(f.rpc({ method: 'status', params: { taskId: f.taskId } }));
});
