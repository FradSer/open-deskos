#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { parseArgs } = require('node:util')
const { collectReleaseInventory } = require('./lib/release-inventory')
const { planRelease } = require('./lib/release-plan')

function readInput(filename) {
  if (!path.isAbsolute(filename)) throw Error('invalid_input')
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0))
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw Error('invalid_input')
    const chunks = []
    let total = 0
    for (;;) {
      const chunk = Buffer.alloc(65536), count = fs.readSync(fd, chunk, 0, chunk.length, null)
      if (!count) break
      total += count
      if (total > 2 * 1024 * 1024) throw Error('invalid_input')
      chunks.push(chunk.subarray(0, count))
    }
    const after = fs.fstatSync(fd), named = fs.lstatSync(filename)
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || named.dev !== stat.dev || named.ino !== stat.ino || named.isSymbolicLink()) throw Error('invalid_input')
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('invalid_input')
    return result
  } finally { fs.closeSync(fd) }
}

/** The only new public operation is a read-only, non-executable plan. */
function runCli(args = process.argv.slice(2), { stdout = process.stdout } = {}) {
  let values
  try {
    ;({ values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
      'dry-run': { type: 'boolean' }, help: { type: 'boolean' },
      root: { type: 'string' }, snapshot: { type: 'string' }, request: { type: 'string' },
      'unit-snapshot': { type: 'string' }, 'backup-snapshot': { type: 'string' }, 'reserve-bytes': { type: 'string' },
      'reserve-inodes': { type: 'string' }, 'max-age-ms': { type: 'string' },
    } }))
    if (values['dry-run'] === false) throw Error('invalid_arguments')
  } catch {
    stdout.write(JSON.stringify({ schemaVersion: 1, dryRun: true, executionAvailable: false, error: 'invalid_arguments' }) + '\n')
    return 64
  }
  if (values.help) {
    stdout.write('Usage: node scripts/cm5-release.js [--dry-run] [--root ABSOLUTE_PATH] [--snapshot ABSOLUTE_JSON] [--request ABSOLUTE_JSON] [--unit-snapshot ABSOLUTE_JSON] [--backup-snapshot ABSOLUTE_JSON]\nOnly read-only planning is available. Planning never creates a reservation or authorizes deletion.\n')
    return 0
  }
  try {
    const policy = {}
    for (const [option, field] of [['reserve-bytes', 'reserveBytes'], ['reserve-inodes', 'reserveInodes'], ['max-age-ms', 'maxSnapshotAgeMs']]) {
      if (values[option] !== undefined) {
        if (!/^\d+$/.test(values[option]) || !Number.isSafeInteger(Number(values[option]))) throw Error('invalid_input')
        policy[field] = Number(values[option])
      }
    }
    const selectedRoot = values.root ?? process.env.ODK_RUNTIME_ROOT ?? '/opt/odk'
    if (!path.isAbsolute(selectedRoot) || path.normalize(selectedRoot) !== selectedRoot) throw Error('invalid_input')
    if (values.snapshot && (values['unit-snapshot'] || values['backup-snapshot'])) throw Error('invalid_input')
    const inventory = values.snapshot ? readInput(values.snapshot) : collectReleaseInventory({ root: selectedRoot,
      ...(values['unit-snapshot'] ? { unitReferences: readInput(values['unit-snapshot']) } : {}),
      ...(values['backup-snapshot'] ? { backupReferences: readInput(values['backup-snapshot']) } : {}),
    })
    if (values.snapshot && values.root && inventory.root !== values.root) throw Error('invalid_input')
    const request = values.request ? readInput(values.request) : null
    if (typeof inventory.root !== 'string' || inventory.root.length > 4096 || !path.isAbsolute(inventory.root) || path.normalize(inventory.root) !== inventory.root || /[\x00-\x1f]/.test(inventory.root)) throw Error('invalid_input')
    const plan = planRelease({ inventory, request, policy })
    stdout.write(JSON.stringify({ ...plan, reservationCreated: false, legacyExecutionEnforcesAdmission: false,
      observation: { root: inventory.root, complete: inventory.complete === true, uncertaintyCount: Array.isArray(inventory.uncertainties) ? inventory.uncertainties.length : null },
    }, null, 2) + '\n')
    return 0
  } catch {
    // Input files can contain private material. Never echo parse errors or their content.
    stdout.write(JSON.stringify({ schemaVersion: 1, dryRun: true, executionAvailable: false, reservationCreated: false, error: 'invalid_input' }) + '\n')
    return 64
  }
}

if (require.main === module) process.exitCode = runCli()
module.exports = { runCli }
