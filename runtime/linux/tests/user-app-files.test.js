const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { readBoundedFile, ensureDirectory, writeExclusive } = require('../src/user-app-files')

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odesk-files-'))
  return { root, outside: await fs.mkdtemp(path.join(os.tmpdir(), 'odesk-outside-')) }
}

 test('reads regular files exactly and enforces bounds', async () => {
  const { root } = await fixture()
  await fs.mkdir(path.join(root, 'nested'))
  await fs.writeFile(path.join(root, 'nested', 'ok'), 'hello')
  assert.deepEqual(await readBoundedFile(root, 'nested/ok', 5), Buffer.from('hello'))
  await assert.rejects(() => readBoundedFile(root, 'nested/ok', 4), /file-too-large/)
})

test('rejects traversal, symlink paths, nonregular files and root symlink', async () => {
  const { root, outside } = await fixture()
  await fs.writeFile(path.join(outside, 'secret'), 'secret')
  await fs.mkdir(path.join(root, 'dir'))
  await fs.symlink(outside, path.join(root, 'link-dir'))
  await fs.symlink(path.join(outside, 'secret'), path.join(root, 'link-file'))
  await fs.writeFile(path.join(root, 'dir', 'regular'), 'x')
  await assert.rejects(() => readBoundedFile(root, '../secret', 100), /invalid-relative-path/)
  await assert.rejects(() => readBoundedFile(root, '/etc/passwd', 100), /invalid-relative-path/)
  await assert.rejects(() => readBoundedFile(root, 'link-dir/secret', 100), /unsafe-path/)
  await assert.rejects(() => readBoundedFile(root, 'link-file', 100))
  await assert.rejects(() => readBoundedFile(root, 'dir/regular/child', 100))
  await assert.rejects(() => readBoundedFile(path.join(root, 'link-dir'), 'secret', 100), /unsafe-root/)
})

test('creates private directories and writes exclusively without escaping root', async () => {
  const { root, outside } = await fixture()
  const directory = await ensureDirectory(root, 'a/b')
  assert.equal(directory, path.join(root, 'a/b'))
  assert.equal((await fs.stat(directory)).mode & 0o777, 0o700)
  const file = await writeExclusive(root, 'a/b/data', Buffer.from('bytes'))
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  assert.deepEqual(await fs.readFile(file), Buffer.from('bytes'))
  await assert.rejects(() => writeExclusive(root, 'a/b/data', Buffer.from('again')))
  await assert.rejects(() => ensureDirectory(root, '../outside'), /invalid-relative-path/)
  await assert.rejects(() => writeExclusive(root, '../outside/pwned', Buffer.from('no')), /invalid-relative-path/)
  assert.equal(await fs.readdir(outside).then((items) => items.length), 0)
})
