import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const run = promisify(execFile)

test('local package includes frozen runtime inputs and refuses archive replacement', async t => {
  const { packageGmail } = await import('../scripts/package.mjs')
  const directory = await mkdtemp(join(tmpdir(), 'gmail-package-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const { archive } = await packageGmail({ outputDirectory: directory })
  const entries = (await run('tar', ['-tzf', archive])).stdout.trim().split('\n').sort()
  const sourceFiles = ['cli', 'client', 'credentials', 'daemon', 'healthcheck', 'index', 'manifest', 'oauth', 'server', 'socket-bridge', 'socket-path', 'socket-transport'].map(name => `package/src/${name}.mjs`)
  assert.deepEqual(entries, ['package/Dockerfile', 'package/package.json', 'package/pnpm-lock.yaml', 'package/README.md',
    'package/skills/gmail-reading/SKILL.md', ...sourceFiles].sort())
  const extracted = join(directory, 'extracted')
  await mkdir(extracted)
  await run('tar', ['-xzf', archive, '-C', extracted])
  assert.deepEqual(await readFile(join(extracted, 'package/pnpm-lock.yaml')), await readFile(new URL('../pnpm-lock.yaml', import.meta.url)))
  const before = await readFile(archive)
  await assert.rejects(packageGmail({ outputDirectory: directory }), /exist/i)
  assert.deepEqual(await readFile(archive), before)
})

test('local package rejects relative output directories', async () => {
  const { packageGmail } = await import('../scripts/package.mjs')
  await assert.rejects(packageGmail({ outputDirectory: './build' }), /absolute/i)
})
