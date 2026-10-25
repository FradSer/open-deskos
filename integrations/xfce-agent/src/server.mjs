import http from 'node:http';
import net from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { readFile, lstat, chmod, unlink, realpath } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer } from 'ws';

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const methods = new Set(['submit', 'status', 'result', 'cancel', 'resume']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, fields) => object(value) && Object.keys(value).every(key => fields.includes(key));
const safeEqual = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const activeStates = new Set(['queued', 'running', 'pausing', 'cancelling', 'waiting_for_user', 'interrupted', 'reconciling']);
async function body(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 65536) throw Error('request_too_large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function respond(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(bytes.length <= 128 * 1024 ? bytes : '{"ok":false,"error":{"code":"response_too_large"}}');
}
function failure(response, code = 'request_refused', status = 200) { respond(response, status, { ok: false, error: { code } }); }

/** Separate the task socket from authenticated operator input and VNC. */
export async function startDesktopServer({ runtime, driver, rpcSocket, operatorKey, operatorPort = 0, vncSocket, assetsDirectory, operatorHtml } = {}) {
  if (typeof operatorKey !== 'string' || operatorKey.length < 32) throw Error('Operator credential unavailable');
  let stopping = false, fenced = false, operatorEpoch = 0, inputTail = Promise.resolve(), inputAbort = new AbortController(), transitionTail = Promise.resolve();
  let closing, rpcIdentity;
  const connections = new Set();
  const websocketServer = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024, perMessageDeflate: false });
  const origins = new Set();
  const authorized = request => {
    const bearer = request.headers.authorization?.replace(/^Bearer /, '');
    const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('odk_operator='))?.slice(13);
    return safeEqual(bearer, operatorKey) || safeEqual(cookie, operatorKey);
  };
  const sameOrigin = request => !request.headers.origin || origins.has(request.headers.origin);
  function disconnectOperators() {
    for (const { web, stream } of connections) { web.terminate(); stream.destroy(); }
    connections.clear();
  }
  function beginFence() {
    fenced = true;
    operatorEpoch++;
    inputAbort.abort();
    disconnectOperators();
  }
  function transition(taskId, validate, operation) {
    const next = transitionTail.then(async () => {
      if (stopping) throw Error('Operator unavailable');
      const task = await runtime.status(taskId);
      if (!activeStates.has(task.status)) throw Error('Task is not active');
      await validate(task);
      if (stopping) throw Error('Operator unavailable');
      beginFence();
      try {
        await inputTail.catch(() => {});
        await driver.release();
        if (stopping) throw Error('Operator unavailable');
        return await operation();
      } finally {
        disconnectOperators();
        inputAbort = new AbortController();
        fenced = stopping;
      }
    });
    transitionTail = next.catch(() => {});
    return next;
  }
  const noValidation = async () => {};
  const ticketMatches = (a, b) => a.interventionId === b.interventionId && a.expectedRevision === b.expectedRevision;
  async function privateAuthorization(taskId, ticket, epoch) {
    if (stopping || fenced || epoch !== operatorEpoch) throw Error('Private authorization changed');
    const current = await runtime.getPrivateTicket(taskId);
    if (stopping || fenced || epoch !== operatorEpoch || !ticketMatches(current, ticket)) throw Error('Private authorization changed');
  }
  const unsubscribe = driver.onInvalidation?.(() => {
    stopping = true;
    beginFence();
    void inputTail.then(() => driver.release()).catch(() => {});
  });
  async function result(taskId) { return { ...await runtime.status(taskId), ...await runtime.result(taskId) }; }
  const taskServer = http.createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/rpc' || stopping) return failure(response, 'request_refused', 404);
      const value = await body(request);
      if (!exact(value, ['method', 'params']) || !methods.has(value.method) || !object(value.params)) return failure(response, 'invalid_request');
      const { method, params } = value;
      let output;
      if (method === 'submit') {
        if (!exact(params, ['requestId', 'goal', 'desktopId', 'constraints'])) return failure(response, 'invalid_request');
        output = await runtime.submit(params);
      } else {
        if (!exact(params, method === 'resume' ? ['taskId', 'expectedRevision'] : ['taskId']) || !UUID.test(params.taskId ?? '')) return failure(response, 'invalid_request');
        if (method === 'status') output = await runtime.status(params.taskId);
        else if (method === 'result') output = await result(params.taskId);
        else if (method === 'cancel') output = await transition(params.taskId, noValidation, () => runtime.cancel(params.taskId));
        else {
          output = await transition(params.taskId, async task => {
            if (task.status !== 'interrupted' || task.revision !== params.expectedRevision || task.mutationOutcome === 'unknown') throw Error('Operator intervention required');
          }, () => runtime.resume(params.taskId, { expectedRevision: params.expectedRevision }));
        }
      }
      respond(response, 200, { ok: true, result: output });
    } catch { failure(response); }
  });
  taskServer.requestTimeout = 15000;
  taskServer.headersTimeout = 10000;

  const operatorServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!sameOrigin(request) || stopping) return failure(response, 'operator_refused', 403);
      if (request.method === 'GET' && url.pathname === '/operator') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" });
        response.end(await readFile(operatorHtml)); return;
      }
      if (request.method === 'POST' && url.pathname === '/operator/session') {
        const input = await body(request);
        if (!exact(input, ['token']) || !safeEqual(input.token, operatorKey)) return failure(response, 'operator_refused', 403);
        response.setHeader('Set-Cookie', `odk_operator=${operatorKey}; HttpOnly; SameSite=Strict; Path=/operator`);
        respond(response, 200, { ok: true }); return;
      }
      // The login page needs this static script before a session exists.
      if (request.method === 'GET' && url.pathname === '/operator/app.js') {
        response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
        response.end(await readFile(new URL('../web/operator.mjs', import.meta.url))); return;
      }
      if (!authorized(request)) return failure(response, 'operator_refused', 403);
      if (request.method === 'GET' && url.pathname.startsWith('/operator/novnc/') && assetsDirectory) {
        const root = await realpath(resolve(assetsDirectory));
        const file = await realpath(resolve(root, decodeURIComponent(url.pathname.slice('/operator/novnc/'.length))));
        if (!file.startsWith(root + sep) || !['.js', '.css', '.svg', '.png'].includes(extname(file))) return failure(response, 'asset_refused', 404);
        const bytes = await readFile(file);
        response.writeHead(200, { 'Content-Type': extname(file) === '.js' ? 'text/javascript' : extname(file) === '.css' ? 'text/css' : 'image/' + extname(file).slice(1), 'Cache-Control': 'no-store' });
        response.end(bytes); return;
      }
      const match = url.pathname.match(/^\/operator\/tasks\/([a-f0-9-]{36})\/(status|pause|resume|cancel|reconcile|action)$/i);
      if (!match || !UUID.test(match[1])) return failure(response, 'operator_refused', 404);
      const [, taskId, method] = match;
      if (method === 'status' && request.method === 'GET') {
        const task = await runtime.status(taskId);
        const ticket = task.status === 'waiting_for_user' ? await runtime.getPrivateTicket(taskId) : undefined;
        respond(response, 200, { ok: true, result: { ...task, ...(ticket ? { ticket } : {}) } }); return;
      }
      if (request.method !== 'POST') return failure(response, 'operator_refused', 405);
      const input = await body(request);
      let output;
      if (method === 'pause') output = await transition(taskId, noValidation, async () => {
        await runtime.pause(taskId); return { ...await runtime.status(taskId), ticket: await runtime.getPrivateTicket(taskId) };
      });
      else if (method === 'cancel') output = await transition(taskId, noValidation, () => runtime.cancel(taskId));
      else if (method === 'action') {
        if (!exact(input, ['action', 'interventionId', 'expectedRevision']) || !object(input.action)) throw Error('Invalid operator action');
        const epoch = operatorEpoch;
        const action = input.action;
        const execute = async () => {
          await privateAuthorization(taskId, input, epoch);
          await driver.act(action, { signal: inputAbort.signal });
        };
        const next = inputTail.then(execute);
        inputTail = next.catch(() => {});
        await next;
        output = { taskId, privateInputDispatched: true };
      } else {
        if (!exact(input, ['interventionId', 'expectedRevision'])) throw Error('Invalid operator transition');
        output = await transition(taskId, async task => {
          if (task.status === 'waiting_for_user') {
            if (!ticketMatches(await runtime.getPrivateTicket(taskId), input)) throw Error('Private authorization changed');
          } else if (method !== 'reconcile' || task.status !== 'reconciling' || input.expectedRevision !== task.revision || input.interventionId !== undefined) throw Error('Private authorization changed');
          if (method === 'resume' && task.mutationOutcome === 'unknown') throw Error('Unknown action outcome');
        }, async () => {
          if ((await driver.inspect()).privacyRequired) throw Error('Private page still open');
          return method === 'reconcile'
            ? runtime.reconcile(taskId, { ...input, operator: true })
            : runtime.resume(taskId, { ...input, operator: true });
        });
      }
      respond(response, 200, { ok: true, result: output });
    } catch { failure(response, 'operator_refused'); }
  });
  operatorServer.requestTimeout = 15000;
  operatorServer.headersTimeout = 10000;
  operatorServer.on('upgrade', async (request, socket, head) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const match = url.pathname.match(/^\/operator\/tasks\/([a-f0-9-]{36})\/vnc$/i);
      if (!authorized(request) || !sameOrigin(request) || !match || !UUID.test(match[1]) || !vncSocket || stopping || fenced || [...url.searchParams.keys()].some(key => !['interventionId', 'expectedRevision'].includes(key))) throw Error('Refused');
      const ticket = { interventionId: url.searchParams.get('interventionId'), expectedRevision: Number(url.searchParams.get('expectedRevision')) };
      const epoch = operatorEpoch;
      await privateAuthorization(match[1], ticket, epoch);
      websocketServer.handleUpgrade(request, socket, head, web => {
        const stream = net.createConnection({ path: vncSocket });
        const entry = { web, stream, queuedBytes: 0 }; connections.add(entry);
        const stop = () => { connections.delete(entry); stream.destroy(); web.terminate(); };
        web.on('message', bytes => {
          if (entry.queuedBytes + bytes.length > 1024 * 1024) return stop();
          entry.queuedBytes += bytes.length;
          const next = inputTail.then(async () => {
            try { await privateAuthorization(match[1], ticket, epoch); if (!stream.destroyed) stream.write(bytes); }
            finally { entry.queuedBytes -= bytes.length; }
          });
          inputTail = next.catch(stop);
        });
        stream.on('data', bytes => {
          stream.pause();
          void privateAuthorization(match[1], ticket, epoch).then(() => {
            if (web.readyState !== 1 || web.bufferedAmount > 1024 * 1024) return stop();
            web.send(bytes, error => { if (error) stop(); else stream.resume(); });
          }).catch(stop);
        });
        stream.on('error', stop); stream.on('close', stop); web.on('error', stop); web.on('close', stop);
      });
    } catch { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); }
  });
  const listen = (server, options) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(options, () => { server.removeListener('error', reject); resolve(); }); });
  try {
    try { const entry = await lstat(rpcSocket); if (!entry.isSocket() || entry.uid !== process.getuid()) throw Error('Socket is not owned'); await unlink(rpcSocket); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await listen(taskServer, { path: rpcSocket });
    await chmod(rpcSocket, 0o600);
    rpcIdentity = await lstat(rpcSocket);
    await listen(operatorServer, { host: '127.0.0.1', port: operatorPort });
    const port = operatorServer.address().port;
    origins.add(`http://127.0.0.1:${port}`); origins.add(`http://localhost:${port}`);
    return { operatorPort: port,
      async close() {
        if (!closing) closing = (async () => {
          stopping = true;
          beginFence();
          const errors = [];
          try {
            unsubscribe?.();
            await transitionTail;
            await inputTail.catch(() => {});
            await driver.release();
          } catch (error) { errors.push(error); }
          finally {
            disconnectOperators();
            const results = await Promise.allSettled([taskServer, operatorServer].map(server => new Promise((resolve, reject) => {
              server.close(error => { if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error); else resolve(); });
              server.closeAllConnections();
            })));
            for (const result of results) if (result.status === 'rejected') errors.push(result.reason);
            await new Promise(resolve => websocketServer.close(resolve));
            try {
              const entry = await lstat(rpcSocket);
              if (!entry.isSocket() || entry.dev !== rpcIdentity.dev || entry.ino !== rpcIdentity.ino) throw Error('RPC socket ownership changed');
              await unlink(rpcSocket);
            } catch (error) { if (error.code !== 'ENOENT') errors.push(error); }
          }
          if (errors.length) throw errors[0];
        })();
        return closing;
      },
    };
  } catch (error) { taskServer.close(); operatorServer.close(); throw error; }
}
