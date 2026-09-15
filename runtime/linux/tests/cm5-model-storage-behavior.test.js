const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const sourceScript = path.resolve(__dirname, '..', 'scripts', 'cm5-migrate-models-to-ssd.sh')

function setupHarness({ mounted = false, mountedSource = '/dev/nvme0n1p1', mountedFsroot = '/models/rk', withBackup = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cm5-model-storage-'))
  const bin = path.join(root, 'bin')
  const runtime = path.join(root, 'runtime')
  const destination = path.join(root, 'ssd', 'models', 'rk')
  const backup = `${runtime}.rootfs-backup`
  fs.mkdirSync(bin, { recursive: true })
  fs.mkdirSync(destination, { recursive: true })
  fs.writeFileSync(path.join(destination, 'model.bin'), 'verified-model')
  if (withBackup) {
    fs.mkdirSync(backup, { recursive: true })
    fs.writeFileSync(path.join(backup, 'model.bin'), 'verified-model')
  } else {
    fs.mkdirSync(runtime, { recursive: true })
    fs.writeFileSync(path.join(runtime, 'model.bin'), 'verified-model')
  }
  const state = path.join(root, 'mount-state')
  fs.writeFileSync(state, `${path.join(root, 'ssd')}\t/dev/nvme0n1p1\t/\trw\n${destination}\t/dev/nvme0n1p1\t${mountedFsroot}\trw\n${mounted ? `${runtime}\t${mountedSource}\t${mountedFsroot}\tro\n` : ''}`)
  const log = path.join(root, 'commands.log')
  const mockFindmnt = `#!/bin/sh
state=${JSON.stringify(state)}
target=""
field=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -T) target=$2; shift 2 ;;
    -o) field=$2; shift 2 ;;
    -n) shift ;;
    *) shift ;;
  esac
done
[ -f "$state" ] || exit 1
line=$(awk -F '\\t' -v t="$target" '$1 == t { print; exit }' "$state")
[ -n "$line" ] || exit 1
case "$field" in
  TARGET) printf '%s\\n' "$(printf '%s' "$line" | cut -f1)" ;;
  SOURCE) printf '%s\\n' "$(printf '%s' "$line" | cut -f2)" ;;
  FSROOT) printf '%s\\n' "$(printf '%s' "$line" | cut -f3)" ;;
  OPTIONS) printf '%s\\n' "$(printf '%s' "$line" | cut -f4)" ;;
  SOURCE,FSROOT) printf '%s %s\\n' "$(printf '%s' "$line" | cut -f2)" "$(printf '%s' "$line" | cut -f3)" ;;
esac
`
  fs.writeFileSync(path.join(bin, 'findmnt'), mockFindmnt, { mode: 0o755 })
  for (const command of ['mount', 'umount', 'rsync', 'systemctl', 'python3']) {
    fs.writeFileSync(path.join(bin, command), `#!/bin/sh\necho ${command} "$@" >> ${JSON.stringify(log)}\n`, { mode: 0o755 })
  }
  return { root, bin, runtime, destination, backup, state, log }
}

function runFunction(harness) {
  const command = `source ${JSON.stringify(sourceScript)}; SSD_MOUNT=${JSON.stringify(path.join(harness.root, 'ssd'))}; migrate_payload ${JSON.stringify(harness.runtime)} ${JSON.stringify(harness.destination)}`
  return spawnSync('bash', ['-c', command], {
    env: { ...process.env, PATH: `${harness.bin}:${process.env.PATH}`, ODK_MODEL_MIGRATION_LIBRARY: '1' },
    encoding: 'utf8',
  })
}

test('interrupted active bind removes the obsolete verified root backup', () => {
  const harness = setupHarness({ mounted: true, mountedFsroot: '/models/rk', withBackup: true })
  const result = runFunction(harness)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(fs.existsSync(harness.backup), false)
  assert.match(result.stdout, /completed interrupted migration/)
})

test('lookalike FSROOT on another device is rejected', () => {
  const harness = setupHarness({ mounted: true, mountedSource: '/dev/mmcblk9p1', mountedFsroot: '/models/rk' })
  const result = runFunction(harness)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unexpected mount/)
  assert.equal(fs.readFileSync(path.join(harness.destination, 'model.bin'), 'utf8'), 'verified-model')
})
