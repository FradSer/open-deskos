const { notPortedOnWindows } = require("./not-ported")
// A Windows Shell Host does not port this capability; the reference host runs it.
if (notPortedOnWindows(require("node:test").test, "cm5-tooling")) return

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const validator = path.join(__dirname, '../scripts/validate-runtime-dependencies.js')

function candidate(t, complete) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-dependencies-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { mqtt: '1.0.0' } }))
  const modules = path.join(root, 'node_modules')
  const mqttModules = path.join(modules, '.pnpm/mqtt@1.0.0/node_modules')
  fs.mkdirSync(path.join(mqttModules, 'mqtt'), { recursive: true })
  fs.writeFileSync(path.join(mqttModules, 'mqtt/index.js'), "module.exports = require('mqtt-packet')\n")
  fs.symlinkSync('.pnpm/mqtt@1.0.0/node_modules/mqtt', path.join(modules, 'mqtt'))
  fs.symlinkSync('../../mqtt-packet@1.0.0/node_modules/mqtt-packet', path.join(mqttModules, 'mqtt-packet'))
  if (complete) {
    const packet = path.join(modules, '.pnpm/mqtt-packet@1.0.0/node_modules/mqtt-packet')
    fs.mkdirSync(packet, { recursive: true })
    fs.writeFileSync(path.join(packet, 'index.js'), 'module.exports = {}\n')
  }
  return root
}

function validate(root) {
  return spawnSync(process.execPath, [validator, root], { encoding: 'utf8' })
}

// Browser-asset dependency: shipped inside the release and loaded by a script
// tag, with no main or exports entry for Node to resolve.
function assetCandidate(t, { external = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-assets-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@highlightjs/cdn-assets': '11.12.0' } }))
  const modules = path.join(root, 'node_modules')
  fs.mkdirSync(modules, { recursive: true })
  let packageDir
  if (external) {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-assets-external-'))
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
    packageDir = path.join(outside, 'cdn-assets')
  } else {
    packageDir = path.join(modules, '.pnpm/@highlightjs+cdn-assets@11.12.0/node_modules/@highlightjs/cdn-assets')
  }
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: '@highlightjs/cdn-assets', version: '11.12.0' }))
  fs.writeFileSync(path.join(packageDir, 'highlight.min.js'), '/* asset */\n')
  const link = path.join(modules, '@highlightjs/cdn-assets')
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.symlinkSync(packageDir, link)
  return root
}

function importOnlyCandidate(t, { external = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-import-only-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@glass-sdk/liquid-glass': '0.0.2' } }))
  const modules = path.join(root, 'node_modules')
  fs.mkdirSync(modules, { recursive: true })
  let packageDir
  if (external) {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-import-only-external-'))
    t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
    packageDir = path.join(outside, 'liquid-glass')
  } else {
    packageDir = path.join(modules, '.pnpm/@glass-sdk+liquid-glass@0.0.2/node_modules/@glass-sdk/liquid-glass')
  }
  fs.mkdirSync(path.join(packageDir, 'dist'), { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({
    name: '@glass-sdk/liquid-glass',
    version: '0.0.2',
    type: 'module',
    exports: {
      '.': { types: './dist/types/index.d.ts', import: './dist/index.js' },
      './dom': { types: './dist/types/dom/index.d.ts', import: './dist/dom.js' },
    },
  }))
  fs.writeFileSync(path.join(packageDir, 'dist/index.js'), 'export const glass = true\n')
  fs.writeFileSync(path.join(packageDir, 'dist/dom.js'), 'export const scene = true\n')
  const link = path.join(modules, '@glass-sdk/liquid-glass')
  fs.mkdirSync(path.dirname(link), { recursive: true })
  fs.symlinkSync(packageDir, link)
  return root
}

test('accepts an asset-only dependency shipped inside the candidate', (t) => {
  const result = validate(assetCandidate(t))
  assert.equal(result.status, 0, result.stderr)
})

test('still rejects an asset-only dependency that resolves outside the candidate', (t) => {
  const result = validate(assetCandidate(t, { external: true }))
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /@highlightjs\/cdn-assets resolves outside the candidate release/)
})

test('accepts an import-only dependency shipped inside the candidate', (t) => {
  const result = validate(importOnlyCandidate(t))
  assert.equal(result.status, 0, result.stderr)
})

test('rejects an import-only dependency that resolves outside the candidate', (t) => {
  const result = validate(importOnlyCandidate(t, { external: true }))
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /@glass-sdk\/liquid-glass resolves outside the candidate release/)
})

test('rejects a declared dependency that is not installed at all', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-missing-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@highlightjs/cdn-assets': '11.12.0' } }))
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  const result = validate(root)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /@highlightjs\/cdn-assets/)
})

test('rejects a pnpm candidate whose direct dependency has a missing transitive package', (t) => {
  const result = validate(candidate(t, false))
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Cannot find module 'mqtt-packet'/)
  assert.match(result.stderr, /runtime dependency validation failed/)
})

test('loads a complete pnpm dependency tree from the candidate, not the working directory', (t) => {
  const result = validate(candidate(t, true))
  assert.equal(result.status, 0, result.stderr)
})

test('rejects a direct dependency that resolves outside the candidate', (t) => {
  const parent = candidate(t, true)
  const root = path.join(parent, 'candidate')
  fs.mkdirSync(root)
  fs.copyFileSync(path.join(parent, 'package.json'), path.join(root, 'package.json'))
  const result = validate(root)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /mqtt resolves outside the candidate release/)
})

test('candidate Electron browser mode rejects missing transitive dependencies', (t) => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [validator, candidate(t, false)], { encoding: 'utf8', env, timeout: 15000 })
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Cannot find module 'mqtt-packet'/)
})

test('candidate Electron browser mode accepts complete dependencies and exits', (t) => {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [validator, candidate(t, true)], { encoding: 'utf8', env, timeout: 15000 })
  assert.equal(result.status, 0, result.stderr)
})

for (const runtime of ['Node', 'Electron browser']) {
  for (const source of ['NODE_PATH', 'pnpm symlink']) {
    test(`${runtime} rejects a transitive dependency supplied by external ${source}`, (t) => {
      const root = candidate(t, false)
      const external = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-external-'))
      t.after(() => fs.rmSync(external, { recursive: true, force: true }))
      const packet = path.join(external, 'mqtt-packet')
      fs.mkdirSync(packet)
      fs.writeFileSync(path.join(packet, 'index.js'), 'module.exports = {}\n')
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      delete env.NODE_PATH
      if (source === 'NODE_PATH') {
        env.NODE_PATH = external
      } else {
        const link = path.join(root, 'node_modules/.pnpm/mqtt@1.0.0/node_modules/mqtt-packet')
        fs.unlinkSync(link)
        fs.symlinkSync(packet, link)
      }
      const executable = runtime === 'Node' ? process.execPath : require('electron')
      const result = spawnSync(executable, [validator, root], { encoding: 'utf8', env, timeout: 15000 })
      assert.equal(result.status, 1, result.stderr)
      if (runtime === 'Electron browser' && source === 'NODE_PATH' && result.stderr.includes("Cannot find module 'mqtt-packet'")) {
        assert.match(result.stderr, /runtime dependency validation failed/)
      } else {
        assert.match(result.stderr, /outside the candidate release/)
        assert.ok(result.stderr.includes(fs.realpathSync(path.join(packet, 'index.js'))), result.stderr)
      }
    })
  }
}

test('checks dependencies before graphical smoke in every release preflight', () => {
  const script = fs.readFileSync(path.join(__dirname, '../scripts/verify-release.sh'), 'utf8')
  assert.match(script, /env -u ELECTRON_RUN_AS_NODE "\$\{DIR\}\/node_modules\/\.bin\/electron" "\$\{DIR\}\/scripts\/validate-runtime-dependencies\.js" "\$\{DIR\}"/)
  assert.ok(script.indexOf('validate-runtime-dependencies.js') < script.indexOf('./run.sh --smoke'))

})
