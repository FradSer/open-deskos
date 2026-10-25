import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeWorker } from '../src/main.mjs';

test('Given canonical coordinator modules When the fixture entry has no private arguments Then imports resolve before safe refusal', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'odk-xfce-entry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'preserve.txt'), 'untouched');
  const entry = fileURLToPath(new URL('../scripts/test-anonymous-loop-live.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [entry], { cwd: directory, encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /Private --config and --directory are required/);
  assert.doesNotMatch(child.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.equal(child.stdout, '');
  assert.deepEqual(await readdir(directory), ['preserve.txt']);
});

for (const phase of ['model', 'runtime', 'server']) test(`Given VM invalidation during ${phase} initialization When startup settles Then every created resource closes and ready is refused`, async () => {
  let notify, createdRuntime = false, createdServer = false, runtimeClosed = 0, serverClosed = 0, driverClosed = 0, markers = 0;
  const driver = { onInvalidation: listener => { notify = listener; }, close: async () => { driverClosed++; } };
  const pending = initializeWorker({ driver,
    createDecision: async () => { if (phase === 'model') notify('RESET'); return () => {}; },
    openRuntime: async () => { createdRuntime = true; if (phase === 'runtime') notify('RESET'); return { close: async () => { runtimeClosed++; } }; },
    openServer: async () => { createdServer = true; if (phase === 'server') notify('RESET'); return { close: async () => { serverClosed++; } }; },
    recordInvalidation: async () => { markers++; },
  });
  await assert.rejects(pending, /VM changed/);
  assert.equal(driverClosed, 1);
  assert.equal(runtimeClosed, Number(createdRuntime));
  assert.equal(serverClosed, Number(createdServer));
  assert.equal(markers, 1);
});
test('Given a ready worker When VM invalidates Then runtime and transport close even if recording fails', async () => {
  let notify, runtimeClosed = 0, serverClosed = 0, driverClosed = 0;
  const worker = await initializeWorker({
    driver: { onInvalidation: listener => { notify = listener; }, close: async () => { driverClosed++; } },
    createDecision: async () => () => {},
    openRuntime: async () => ({ close: async () => { runtimeClosed++; } }),
    openServer: async () => ({ close: async () => { serverClosed++; } }),
    recordInvalidation: async () => { throw Error('Cannot persist'); },
  });
  notify('DISCONNECTED');
  await assert.rejects(worker.close(), /Cannot persist/);
  assert.equal(runtimeClosed, 1); assert.equal(serverClosed, 1); assert.equal(driverClosed, 1);
});
