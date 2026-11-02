const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { contentDigest, receiptPath, recordReceipt, main } = require('../scripts/release-host-preflight.js')

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-host-preflight-'))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true })
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'shell.js'), 'module.exports = 1\n')
  fs.writeFileSync(path.join(root, 'tests', 'shell.test.js'), '// fixture\n')
  fs.writeFileSync(path.join(root, 'scripts', 'run.js'), '// fixture\n')
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}\n')
  fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n')
  fs.writeFileSync(path.join(root, 'uno.config.mjs'), 'export default {}\n')
  return root
}

const environment = root => ({ ODK_HOST_PREFLIGHT_DIR: path.join(root, 'receipts'), HOME: root })
const quiet = { write() { return true } }

test('a host receipt is bound to the exact content digest', () => {
  const root = fixture()
  const env = environment(root)
  const first = contentDigest(root)
  fs.writeFileSync(path.join(root, 'src', 'shell.js'), 'module.exports = 2\n')
  const second = contentDigest(root)
  assert.notEqual(first.digest, second.digest)
  assert.ok(first.files >= 6 && second.files >= 6)
  assert.notEqual(receiptPath(root, first.digest, env), receiptPath(root, second.digest, env))
})

test('--require refuses staging without a passing receipt for this content', () => {
  const root = fixture()
  const env = environment(root)
  const status = main(['--require'], { root, env, stdout: quiet, stderr: quiet })
  assert.equal(status, 1)
  const receipt = recordReceipt(root, contentDigest(root), env)
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(main(['--require'], { root, env, stdout: quiet, stderr: quiet }), 0)
})

test('--run records a receipt only after the host tests pass', () => {
  const root = fixture()
  const env = environment(root)
  const failed = main(['--run'], { root, env, stdout: quiet, stderr: quiet, run: () => ({ status: 1 }) })
  assert.equal(failed, 1)
  assert.equal(fs.existsSync(receiptPath(root, contentDigest(root).digest, env)), false)
  const passed = main(['--run'], { root, env, stdout: quiet, stderr: quiet, run: () => ({ status: 0 }) })
  assert.equal(passed, 0)
  assert.equal(main(['--require'], { root, env, stdout: quiet, stderr: quiet }), 0)
  assert.match(JSON.parse(fs.readFileSync(receiptPath(root, contentDigest(root).digest, env), 'utf8')).command, /node --test/)
})