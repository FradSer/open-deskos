import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const sdkEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
const manifestPath = new URL('../package.json', import.meta.url)

test('the declared, frozen and installed Personal Agent/Hosted Pi SDK is exactly 1.4.0', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.dependencies['@earendil-works/pi-coding-agent'], '1.4.0')
  const installed = JSON.parse(await readFile(join(dirname(sdkEntry), '..', 'package.json'), 'utf8'))
  assert.equal(installed.version, '1.4.0')
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.match(lock, /'@earendil-works\/pi-coding-agent':[\s\S]*?specifier: 1\.4\.0[\s\S]*?version: 1\.4\.0/)
})

test('codemode resolves the same v1.4 runtime family as its SDK', async () => {
  const codemode = JSON.parse(await readFile(join(dirname(sdkEntry), '..', '..', 'pi-codemode', 'package.json'), 'utf8'))
  assert.equal(codemode.version, '1.4.0')
})

test('every direct Pi component is declared, frozen and installed at 1.4.0', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  for (const name of ['chord', 'pi-ai', 'pi-codemode', 'pi-durable', 'pi-env']) {
    const dependency = `@earendil-works/${name}`
    assert.equal(manifest.dependencies[dependency], '1.4.0')
    const entry = fileURLToPath(import.meta.resolve(dependency))
    const installed = JSON.parse(await readFile(join(dirname(entry), '..', 'package.json'), 'utf8'))
    assert.equal(installed.version, '1.4.0')
    assert.match(lock, new RegExp(`'${dependency}':[\\s\\S]*?specifier: 1\\.4\\.0[\\s\\S]*?version: 1\\.4\\.0`))
  }
})
