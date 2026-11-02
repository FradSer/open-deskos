#!/usr/bin/env node
// The staging host runs the full contract suite once per content digest. The
// device then proves the artifact loads and paints, so a deploy never pays for
// thousands of host-agnostic tests a second time on ARM.
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { spawnSync } = require('node:child_process')

const DIGEST_INPUTS = ['src', 'tests', 'scripts', 'package.json', 'pnpm-lock.yaml', 'uno.config.mjs']
const SKIP = new Set(['node_modules', '.git'])

function walk(absolute, relative, files) {
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolute).sort()) {
      if (SKIP.has(entry)) continue
      walk(path.join(absolute, entry), relative ? `${relative}/${entry}` : entry, files)
    }
    return
  }
  if (stat.isFile()) files.push(relative)
}

/** One digest for every input that can change test behaviour. */
function contentDigest(root) {
  const files = []
  for (const entry of DIGEST_INPUTS) {
    const absolute = path.join(root, entry)
    if (fs.existsSync(absolute)) walk(absolute, entry, files)
  }
  const digest = createHash('sha256')
  for (const file of files.sort()) {
    digest.update(file)
    digest.update('\0')
    digest.update(fs.readFileSync(path.join(root, file)))
    digest.update('\0')
  }
  return { digest: digest.digest('hex'), files: files.length }
}

function receiptRoot(root, env = process.env) {
  return env.ODK_HOST_PREFLIGHT_DIR || path.join(env.XDG_STATE_HOME || path.join(env.HOME || root, '.local', 'state'), 'odk', 'host-preflight')
}

function receiptPath(root, digest, env) {
  return path.join(receiptRoot(root, env), `${digest}.json`)
}

function readReceipt(root, digest, env = process.env) {
  try { return JSON.parse(fs.readFileSync(receiptPath(root, digest, env), 'utf8')) } catch { return undefined }
}

function recordReceipt(root, { digest, files }, env = process.env) {
  const directory = receiptRoot(root, env)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const receipt = { schemaVersion: 1, digest, files, node: process.version, platform: process.platform, createdAt: new Date().toISOString(), command: 'node --test --test-concurrency=2 tests/*.test.js' }
  fs.writeFileSync(receiptPath(root, digest, env), `${JSON.stringify(receipt)}\n`, { mode: 0o600 })
  return receipt
}

// A checkout may link node_modules from another root, where pnpm refuses to
// run its dependency check. Invoke the same test command directly instead.
function testFiles(root) {
  return fs.readdirSync(path.join(root, 'tests')).filter(name => name.endsWith('.test.js')).sort()
}

function main(args = process.argv.slice(2), { root = path.resolve(__dirname, '..'), env = process.env, stdout = process.stdout, stderr = process.stderr,
  run = () => spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...testFiles(root).map(name => `tests/${name}`)],
    { cwd: root, stdio: 'inherit', env }) } = {}) {
  const mode = args.find(argument => argument.startsWith('--')) ?? '--status'
  if (!['--status', '--require', '--run'].includes(mode) || args.length > 1) {
    stderr.write('usage: release-host-preflight.mjs [--status|--require|--run]\n')
    return 64
  }
  const { digest, files } = contentDigest(root)
  if (mode === '--run') {
    const result = run()
    if (result.status !== 0) { stdout.write(`${JSON.stringify({ ok: false, digest, reason: 'host tests failed' })}\n`); return 1 }
    const receipt = recordReceipt(root, { digest, files }, env)
    stdout.write(`${JSON.stringify({ ok: true, digest, receipt: receiptPath(root, digest, env) })}\n`)
    return 0
  }
  const receipt = readReceipt(root, digest, env)
  const present = receipt?.digest === digest
  stdout.write(`${JSON.stringify({ ok: present, digest, files, receipt: present ? receiptPath(root, digest, env) : null })}\n`)
  if (present) return 0
  if (mode === '--status') return 0
  stderr.write('No host test receipt for this content. Run:\n  cd runtime/shell && node scripts/release-host-preflight.mjs --run\n')
  return 1
}

if (require.main === module) process.exitCode = main()

module.exports = { contentDigest, receiptPath, readReceipt, recordReceipt, main }