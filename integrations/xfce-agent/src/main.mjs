import { lstat, mkdir, readFile, writeFile, appendFile, access, open } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createQmpDesktopDriver } from './driver.mjs';
import { createVisualDecision } from './model.mjs';
import { openDesktopRuntime } from './runtime.mjs';
import { startDesktopServer } from './server.mjs';

async function privateDirectory(path) {
  for (let parent = path; parent !== dirname(parent); parent = dirname(parent)) {
    try { if ((await lstat(parent)).isSymbolicLink()) throw Error('Linked runtime path'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || (info.mode & 0o077) || info.uid !== process.getuid()) throw Error('Private user-owned directory required');
}
async function privateJson(filename) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16384 || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error('Private configuration required');
  return JSON.parse(await readFile(filename, 'utf8'));
}
export async function initializeWorker({ driver, createDecision, openRuntime, openServer, recordInvalidation }) {
  let runtime, server, closing, invalidated = false, initializing = true, recording = Promise.resolve();
  const live = () => { if (invalidated) throw Error('VM changed during worker initialization'); };
  const close = () => closing ??= (async () => {
    const results = await Promise.allSettled([runtime?.close(), server?.close()]);
    try { await driver.close(); } finally { await recording; }
    if (results.some(result => result.status === 'rejected')) throw Error('Worker shutdown requires operator inspection');
  })();
  driver.onInvalidation(event => {
    invalidated = true;
    recording = Promise.resolve().then(() => recordInvalidation(event));
    void recording.catch(() => {});
    if (!initializing) void close().catch(() => { console.error('VM invalidation requires operator inspection before restart.'); });
  });
  try {
    live(); const decide = await createDecision();
    live(); runtime = await openRuntime(decide);
    live(); server = await openServer(runtime);
    live(); initializing = false;
    return { runtime, driver, server, close };
  } catch (error) { initializing = false; await close().catch(() => {}); throw error; }
}
async function durableMarker(filename, value) {
  let file;
  try { file = await open(filename, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') return; throw error; }
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); } finally { await file.close(); }
  const parent = await open(dirname(filename), 'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
export async function startWorker(configFile, { createDecision = createVisualDecision } = {}) {
  process.umask(0o077);
  if (!isAbsolute(configFile)) throw Error('Absolute private configuration path required');
  const config = await privateJson(configFile);
  const fields = ['stateDirectory', 'rpcSocket', 'qmpSocket', 'vncSocket', 'fixtureEndpoint', 'modelsFile', 'operatorPort', 'assetsDirectory'];
  if (!config || Object.keys(config).some(key => !fields.includes(key)) || fields.some(key => key !== 'operatorPort' && typeof config[key] !== 'string') || !Number.isInteger(config.operatorPort) || config.operatorPort < 0 || config.operatorPort > 65535) throw Error('Invalid worker configuration');
  for (const field of ['stateDirectory', 'rpcSocket', 'qmpSocket', 'vncSocket', 'modelsFile', 'assetsDirectory']) if (!isAbsolute(config[field])) throw Error('Absolute worker paths required');
  if (process.getuid() === 0) throw Error('Run the desktop worker as an ordinary user');
  const nativeRuntime = `/run/user/${process.getuid()}/`;
  if (![config.rpcSocket, config.qmpSocket, config.vncSocket].every(path => resolve(path) === path && path.startsWith(nativeRuntime))) throw Error('Private native runtime sockets required');
  await privateDirectory(config.stateDirectory);
  await privateDirectory(dirname(config.rpcSocket));
  for (const socket of [config.qmpSocket, config.vncSocket]) {
    await privateDirectory(dirname(socket));
    const info = await lstat(socket);
    if (!info.isSocket() || info.uid !== process.getuid()) throw Error('Owned VM sockets required');
  }
  const invalidations = [...new Set([join(config.stateDirectory, 'vm-invalidated.json'), join(dirname(config.rpcSocket), 'vm-invalidated.json')])];
  for (const filename of invalidations) {
    try { await access(filename); throw Error('VM lifecycle changed; operator inspection is required'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const keyFile = join(config.stateDirectory, 'operator-key.json');
  let operatorKey;
  try { ({ operatorKey } = await privateJson(keyFile)); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    operatorKey = randomBytes(32).toString('base64url');
    await writeFile(keyFile, JSON.stringify({ operatorKey }), { flag: 'wx', mode: 0o600 });
  }
  const captureDirectory = join(dirname(config.rpcSocket), 'captures');
  await privateDirectory(captureDirectory);
  const requestsFile = join(config.stateDirectory, 'model-requests.jsonl');
  let loggedBytes = 0, logTail = Promise.resolve();
  try { loggedBytes = (await lstat(requestsFile)).size; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const log = value => {
    const bytes = JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n';
    loggedBytes += Buffer.byteLength(bytes);
    if (loggedBytes > 512 * 1024) return;
    logTail = logTail.then(() => appendFile(requestsFile, bytes, { mode: 0o600 })).catch(() => {});
  };
  const driver = await createQmpDesktopDriver({ ...config, captureDirectory });
  const worker = await initializeWorker({ driver,
    createDecision: () => createDecision({ modelsFile: config.modelsFile, onRequest: log }),
    openRuntime: decide => openDesktopRuntime({ directory: config.stateDirectory, driver, decide, verify: context => driver.verify(context), validateSubmission: task => driver.validateSubmission(task) }),
    openServer: runtime => startDesktopServer({ runtime, driver, rpcSocket: config.rpcSocket, operatorKey, operatorPort: config.operatorPort, vncSocket: config.vncSocket, assetsDirectory: config.assetsDirectory, operatorHtml: new URL('../web/operator.html', import.meta.url) }),
    async recordInvalidation(event) {
      const saved = await Promise.allSettled(invalidations.map(filename => durableMarker(filename, { event, at: new Date().toISOString() })));
      if (saved.every(result => result.status === 'rejected')) throw Error('VM invalidation could not be recorded. Do not restart without operator inspection.');
    },
  });
  return { ...worker, async close() { try { await worker.close(); } finally { await logTail; } }, operatorKeyFile: keyFile };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let worker;
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--config') throw Error('Usage: node src/main.mjs --config /private/worker.json');
    worker = await startWorker(process.argv[3]);
    console.log(JSON.stringify({ ready: true, operatorPort: worker.server.operatorPort, operatorKeyFile: worker.operatorKeyFile }));
    const stop = async () => { try { await worker.close(); process.exitCode = 0; } catch { process.exitCode = 1; } };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
