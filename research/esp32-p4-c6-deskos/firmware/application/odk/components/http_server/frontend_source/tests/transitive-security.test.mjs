import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Resolve through the actual direct consumers without adding test dependencies.
const require = createRequire(import.meta.url)
const solid = createRequire(require.resolve('solid-js/package.json'))
const formatter = createRequire(require.resolve('oxfmt/package.json'))
const seroval = solid('seroval')

test('a forged ArrayBuffer source is rejected while valid typed arrays round-trip', () => {
  const input = new Uint8Array([1, 2, 3])
  assert.deepEqual(seroval.fromJSON(seroval.toJSON(input)), input)
  const malformed = seroval.toJSON(input)
  const object = seroval.toJSON({ length: 32 }).t
  object.i = malformed.t.f.i
  malformed.t.f = object
  // Keep the reproduction small: the vulnerable version allocates only 32 bytes.
  assert.throws(() => seroval.fromJSON(malformed))
})

test('Promise deserialization rejects plugin-produced thenables without invoking them', async () => {
  assert.equal(await seroval.fromJSON(await seroval.toJSONAsync(Promise.resolve(42))), 42)
  let invoked = 0
  const plugin = seroval.createPlugin({
    tag: 'security-fixture', test: value => value?.fixture === true,
    parse: { sync: () => ({}) }, serialize: () => '({})',
    deserialize: () => ({ then(resolve) { invoked++; resolve(42) } }),
  })
  const inner = seroval.toJSON({ fixture: true }, { plugins: [plugin] })
  const malformed = await seroval.toJSONAsync(Promise.resolve(42))
  malformed.t.f = inner.t
  malformed.t.f.i = malformed.t.i + 1
  malformed.m = inner.m
  assert.throws(() => seroval.fromJSON(malformed, { plugins: [plugin] }))
  await Promise.resolve()
  assert.equal(invoked, 0)
})

for (const vector of ['execArgv', 'env', 'filename']) {
  test(`inherited ${vector} cannot redirect the actual formatter worker pool`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'odk-frontend-security-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const worker = join(directory, 'worker.mjs')
    const alternate = join(directory, 'alternate.mjs')
    const preload = join(directory, 'preload.cjs')
    const probe = join(directory, 'probe.mjs')
    const marker = join(directory, 'unexpected-execution')
    writeFileSync(worker, 'export default value => value * 2\n')
    writeFileSync(alternate, 'export default () => "unexpected worker"\n')
    writeFileSync(preload, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'unexpected preload')\n`)
    const source = `
      import { pathToFileURL } from 'node:url';
      const { Tinypool } = await import(pathToFileURL(${JSON.stringify(formatter.resolve('tinypool'))}).href);
      const vector = ${JSON.stringify(vector)};
      if (vector === 'execArgv') Object.prototype.execArgv = ['--require', ${JSON.stringify(preload)}];
      if (vector === 'env') Object.prototype.env = { NODE_OPTIONS: '--require ' + JSON.stringify(${JSON.stringify(preload)}) };
      const pool = new Tinypool({ filename: ${JSON.stringify(worker)}, minThreads: 1, maxThreads: 1 });
      try {
        if (vector === 'filename') Object.prototype.filename = ${JSON.stringify(alternate)};
        const result = await pool.run(21, { signal: new AbortController().signal });
        if (result !== 42) throw Error('An inherited option selected an alternate worker');
      } finally {
        delete Object.prototype.execArgv; delete Object.prototype.env; delete Object.prototype.filename;
        await pool.destroy();
      }
    `
    // Prototype pollution stays inside this bounded disposable process.
    writeFileSync(probe, source)
    const result = spawnSync(process.execPath, [probe], {
      encoding: 'utf8', timeout: 10000, env: { ...process.env, NODE_OPTIONS: '' },
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(existsSync(marker), false, 'An inherited preload must never execute')
  })
}
