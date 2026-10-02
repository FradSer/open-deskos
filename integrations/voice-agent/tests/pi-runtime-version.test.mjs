import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const sdkEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
const manifestPath = new URL('../package.json', import.meta.url)

test('the declared, frozen and installed Voice/Hosted Pi SDK is exactly 1.0.0', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.dependencies['@earendil-works/pi-coding-agent'], '1.0.0')
  const installed = JSON.parse(await readFile(join(dirname(sdkEntry), '..', 'package.json'), 'utf8'))
  assert.equal(installed.version, '1.0.0')
  const lock = await readFile(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  assert.match(lock, /'@earendil-works\/pi-coding-agent':[\s\S]*?specifier: 1\.0\.0[\s\S]*?version: 1\.0\.0/)
})

test('codemode resolves the same v1.0 runtime family as its SDK', async () => {
  const codemode = JSON.parse(await readFile(join(dirname(sdkEntry), '..', '..', 'pi-codemode', 'package.json'), 'utf8'))
  assert.equal(codemode.version, '1.0.0')
})
