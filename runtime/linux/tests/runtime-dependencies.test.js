const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const validator = path.join(__dirname, '../scripts/validate-runtime-dependencies.js')

function candidate(t, complete) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'open-deskos-dependencies-'))
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
      const external = fs.mkdtempSync(path.join(os.tmpdir(), 'open-deskos-external-'))
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
