const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// The runtime runs from a development checkout (runtime/linux beside integrations) or from a release
// (runtime/linux flattened to the release root, integrations sealed beside it). The layout is decided
// by what this directory holds, never by walking up: a stale integrations tree elsewhere on the host
// must not become the tree this test reads.
const RUNTIME = process.cwd()
const RELEASE_LAYOUT = fs.existsSync(path.join(RUNTIME, 'integrations'))
const REPO_ROOT = RELEASE_LAYOUT ? RUNTIME : path.resolve(RUNTIME, '..', '..')
const DOC = path.join(RUNTIME, 'docs/CONFIGURATION.md')

const CODE = /\.(mjs|cjs|js|py)$/
const SHELL = /\.(sh)$/
const SKIP = /(^|\/)(node_modules|tests|features|dist|\.git)(\/|$)/
const NAME = '((?:ODK|ODESK|PI|FUTU)_[A-Z0-9_]+)'
const READERS = [
  /(?:process\.env|env)\.([A-Z][A-Z0-9_]{2,})/g,
  /os\.environ(?:\.[gs]et\(|\[)["']([A-Z][A-Z0-9_]{2,})/g,
  new RegExp(`["']${NAME}["']`, 'g'),
  new RegExp(`\\$\\{?${NAME}`, 'g'),
]

function tree(dir, match, visit) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (SKIP.test(full)) continue
    if (entry.isDirectory()) tree(full, match, visit)
    else if (match.test(entry.name)) visit(full)
  }
}

function readersByFile() {
  const found = new Map()
  const visit = file => {
    const source = fs.readFileSync(file, 'utf8')
    for (const reader of READERS) {
      reader.lastIndex = 0
      let match
      while ((match = reader.exec(source))) {
        if (!found.has(match[1])) found.set(match[1], new Set())
        found.get(match[1]).add(path.relative(REPO_ROOT, file))
      }
    }
  }
  tree(path.join(RUNTIME, 'src'), CODE, visit)
  tree(path.join(RUNTIME, 'scripts'), CODE, visit)
  tree(path.join(RUNTIME, 'integrations'), CODE, visit)
  tree(path.join(REPO_ROOT, 'integrations'), CODE, visit)
  tree(path.join(RUNTIME, 'scripts'), SHELL, visit)
  tree(path.join(RUNTIME, 'integrations'), SHELL, visit)
  tree(path.join(REPO_ROOT, 'integrations'), SHELL, visit)
  return found
}

// Every variable a unit sets is configuration, whether or not code reads it, so the templates are
// inventoried too: a unit that introduces an undocumented seam fails here rather than on a device.
function declaredByUnits() {
  const files = []
  tree(path.join(RUNTIME, 'systemd'), /\.service$/, file => files.push(file))
  tree(path.join(RUNTIME, 'integrations'), /\.service$/, file => files.push(file))
  tree(path.join(REPO_ROOT, 'integrations'), /\.service$/, file => files.push(file))
  tree(path.join(REPO_ROOT, 'integrations'), /\.plist$/, file => files.push(file))
  const declared = new Map()
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8')
    for (const line of source.split('\n')) {
      const environment = line.match(/^\s*Environment=(.*)$/)
      const property = line.match(/^\s*<key>([A-Z][A-Z0-9_]{2,})<\/key>/)
      const assignments = environment ? environment[1].match(/[A-Z][A-Z0-9_]{2,}=/g) || [] : []
      for (const name of [...assignments.map(value => value.slice(0, -1)), ...(property ? [property[1]] : [])]) {
        if (!declared.has(name)) declared.set(name, new Set())
        declared.get(name).add(path.relative(REPO_ROOT, file))
      }
    }
  }
  return declared
}

function inventory() {
  const rows = new Map()
  for (const line of fs.readFileSync(DOC, 'utf8').split('\n')) {
    const row = line.match(/^\| `([A-Z][A-Z0-9_]{2,})` \|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|$/)
    if (row) rows.set(row[1], { layer: row[2].trim(), consumer: row[4].trim(), note: row[6].trim() })
  }
  return rows
}

// A consumer path is written repository-relative; in a release the runtime is flattened, so the same
// reference resolves against this directory instead of the checkout that no longer exists.
function consumerPath(reference) {
  const candidate = RELEASE_LAYOUT ? path.join(RUNTIME, reference.replace(/^runtime\/linux\//, '')) : path.join(REPO_ROOT, reference)
  return fs.existsSync(candidate) ? candidate : null
}

test('the inventory lists every variable the runtime and integrations read', () => {
  const rows = inventory()
  const undocumented = [...readersByFile().keys()].filter(name => !rows.has(name)).sort()
  assert.deepEqual(undocumented, [], `add these to docs/CONFIGURATION.md: ${undocumented.join(', ')}`)
})

test('the inventory names a real consumer that reads each variable', () => {
  const rows = inventory()
  const failures = []
  for (const [name, row] of rows) {
    if (row.consumer.startsWith('外部消费者')) continue
    const references = row.consumer.split(',').map(value => value.trim()).filter(Boolean)
    assert.notEqual(references.length, 0, `${name} names no consumer`)
    for (const reference of references) {
      const file = consumerPath(reference)
      if (!file) { failures.push(`${name}: ${reference} does not exist`); continue }
      if (!fs.readFileSync(file, 'utf8').includes(name)) failures.push(`${name}: ${reference} does not read it`)
    }
  }
  assert.deepEqual(failures, [], failures.join('; '))
})

test('every variable a unit or launch agent declares is inventoried', () => {
  const rows = inventory()
  const undeclared = [...declaredByUnits().keys()].filter(name => !rows.has(name)).sort()
  assert.deepEqual(undeclared, [], `units set variables the inventory does not list: ${undeclared.join(', ')}`)
})

// A device-local value that only restates a code default is configuration the device cannot justify;
// the inventory says so in its own words, and this check keeps the two from drifting apart.
test('the inventory marks the values a device must not restate', () => {
  const rows = inventory()
  assert.match(rows.get('ODESK_VOICE_STT_MODEL').note, /无需设置/)
  assert.match(rows.get('ODK_STT_PORT').note, /唯一声明/)
  assert.equal(rows.get('PI_SESSION_CONTROL_COMMAND'), undefined, 'the removed session-control bridge must not return to the inventory')
})