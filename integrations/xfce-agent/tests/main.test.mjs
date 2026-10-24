import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeWorker } from '../src/main.mjs';

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
