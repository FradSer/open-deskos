'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/odk-link-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath } = require('../src/plugin-config')
const { posixOnlyReason } = require('./not-ported')
const { wait } = require('./helpers/hydra-wire-lifecycle')

test('actual Main bootstrap preserves Open DeskOS Link signed revisions and preload consumers',
  { timeout: 240000, skip: posixOnlyReason('unix-socket') }, async t => {
    const fixture = path.join(__dirname, 'odk-link-main-bootstrap.cjs')
    await fs.access(fixture)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-link-main-'))
    const endpoint = path.join(root, 'link.sock')
    const sockets = new Set()
    const closures = []
    const requests = []
    const sessions = [{ sessionId: 'fixture', uuid: 'fixture', status: 'running', isAlive: true, pid: 1,
      cwd: '/fixture', workspaceName: 'Fixture', latestGoal: 'Preserve protocol', updatedAt: 1700000000000 }]
    const snapshot = { ok: true, scannedAt: 1700000000000, sessions,
      workspaces: [{ name: 'Fixture', cwd: '/fixture', sessions }],
      summary: { total: 1, running: 1, settled: 0, exited: 0, workspacesCount: 1 } }
    const replies = { snapshot, machines: { machines: [{ id: 'fixture-machine' }] },
      'hosted-sessions': { ok: true, sessions: [], scannedAt: 1700000000000 },
      events: { ok: true, events: [{ kind: 'assistant', text: 'Reported event' }], truncated: true } }
    const server = net.createServer(socket => {
      sockets.add(socket)
      closures.push(new Promise(resolve => socket.once('close', resolve)))
      socket.on('error', () => {})
      socket.on('close', () => sockets.delete(socket))
      let pending = ''
      socket.on('data', bytes => {
        pending += bytes.toString()
        if (!pending.includes('\n')) return
        const record = JSON.parse(pending.trim())
        requests.push(record)
        assert.equal(record.v, 1)
        if (record.type === 'subscribe-completions') {
          assert.deepEqual(record,{v:1,type:'subscribe-completions'})
          socket.write(JSON.stringify({v:1,type:'completion'})+'\n')
          return
        }
        assert.ok(Object.hasOwn(replies, record.type))
        socket.end(JSON.stringify(replies[record.type]) + '\n')
      })
    })
    const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
      XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
      ODK_SHELL_TEST_MODE: '1', ODK_LINK_SOCKET: endpoint,
      ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280' }
    delete env.XDG_RUNTIME_DIR
    const enabled = new Set(['odk.source.odk-link', 'odk.source.pi-sessions', 'odk.source.pi-events', 'odk.system.renderer-development'])
    env.ODK_DISABLED_PLUGINS = createMainPlugins().map(plugin => plugin.manifest.id).filter(id => !enabled.has(id)).join(',')
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) })
      const native = await install(root, env, t.signal)
      const pids = new Set()
      const launch = async version => {
        const profile = await fs.mkdtemp(path.join(root, 'electron-'))
        const childEnv = { ...env, ODK_LINK_BOOTSTRAP_PROFILE: profile, ODK_LINK_BOOTSTRAP_VERSION: version }
        delete childEnv.ELECTRON_RUN_AS_NODE
        const operation = execFile(require('electron'), isolatedElectronArgs([`--user-data-dir=${profile}`, fixture]), {
          env: childEnv, timeout: 55000, killSignal: 'SIGKILL', signal: t.signal, maxBuffer: 1024 * 1024,
        })
        const closed = new Promise(resolve => operation.child.once('close', resolve))
        try {
          const result = await operation
          const report = JSON.parse(result.stdout.trim().split('\n').pop())
          assert.equal(report.pid, operation.child.pid)
          assert.equal(pids.has(report.pid), false)
          pids.add(report.pid)
          assert.equal(report.productionMain, true)
          assert.equal(report.actualPreload, true)
          assert.equal(report.version, version)
          assert.equal(report.executedVersion, version)
          assert.equal(report.defaultConstructions, version === '1.0.0' ? 1 : 0)
          assert.equal(report.handlersReleased, true)
          assert.equal(report.hidden, true)
          await wait(Promise.all(closures), t.signal)
          assert.equal(sockets.size, 0, 'Each Main process must release its request connections')
          return report.consumer
        } finally {
          await closed
          await fs.rm(profile, { recursive: true, force: true })
        }
      }
      const id = 'odk.source.odk-link'
      const first = native.config().plugins[id].native.revision
      const firstSnapshot = await native.store.snapshot(first)
      const consumer = await launch('2.0.0')
      const updated = native.bundle('3.0.0')
      await native.command(['update', id, updated, '--keyring', native.keyring, '--trust', '--grant', 'source.odk-link'])
      const second = native.config().plugins[id].native.revision
      const secondSnapshot = await native.store.snapshot(second)
      assert.notEqual(first, second)
      assert.deepEqual(await launch('3.0.0'), consumer)
      const bytes = await fs.readFile(resolveConfigPath(env))
      await fs.appendFile(path.join(updated, 'entry.cjs'), '\nthrow Error("Unsigned Open DeskOS Link update")')
      await assert.rejects(native.command(['update', id, updated, '--keyring', native.keyring, '--trust', '--grant', 'source.odk-link']), /native file hash mismatch/)
      assert.deepEqual(await fs.readFile(resolveConfigPath(env)), bytes)
      await native.command(['rollback', id, '--keyring', native.keyring])
      assert.equal(native.config().plugins[id].native.revision, first)
      assert.deepEqual(await launch('2.0.0'), consumer)
      await native.command(['remove', id])
      assert.deepEqual(await launch('1.0.0'), consumer)
      assert.equal(pids.size, 4)
      assert.deepEqual([...(await native.store.snapshot(first)).files], [...firstSnapshot.files])
      assert.deepEqual([...(await native.store.snapshot(second)).files], [...secondSnapshot.files])
      assert.deepEqual(consumer, { sessionId: 'fixture', goal: 'Preserve protocol', running: 1, completionNotifications:{state:'live'},
        events: [{ kind: 'assistant', text: 'Reported event' }], truncated: true })
      assert.equal(requests.filter(record=>record.type==='subscribe-completions').length,4,'each actual Main process owns one completion subscription')
      assert.ok(['machines', 'hosted-sessions', 'snapshot', 'events'].every(type => requests.some(record => record.type === type)))
      assert.ok(requests.some(record => record.type === 'events' && record.sessionId === 'fixture' && record.hostedPi === true))
    } finally {
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await fs.rm(root, { recursive: true, force: true })
    }
  })
