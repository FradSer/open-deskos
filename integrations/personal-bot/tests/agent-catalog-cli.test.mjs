import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const cli = fileURLToPath(new URL('../src/agent-catalog/cli.mjs', import.meta.url))
const execute = promisify(execFile)

test('operator CLI installs, lists, reads, and removes a Skill using only an explicit catalog path', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-agent-catalog-cli-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const source = join(directory, 'source')
  await mkdir(source)
  await writeFile(join(source, 'SKILL.md'), '---\nname: regional-report\ndescription: Prepare a regional report.\n---\nCheck each requested region.')
  const args = ['--directory', join(directory, 'catalog')]
  const run = (...command) => execute(process.execPath, [cli, ...args, ...command], { env: { PATH: process.env.PATH }, timeout: 10000 })
  assert.equal(JSON.parse((await run('install-skill', source)).stdout).id, 'regional-report')
  assert.equal(JSON.parse((await run('list')).stdout)[0].kind, 'skill')
  assert.match((await run('read-skill', 'regional-report')).stdout, /Check each requested region/)
  await run('remove', 'regional-report')
  assert.deepEqual(JSON.parse((await run('list')).stdout), [])
  await assert.rejects(execute(process.execPath, [cli, 'list'], { env: { PATH: process.env.PATH } }), /explicit private catalog directory/)
})
