'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const net = require('node:net')
const execFile = require('node:util').promisify(require('node:child_process').execFile)
const { install } = require('./helpers/pi-events-selection')
const { installPiViews } = require('./helpers/pi-view-selection')
const { createMainPlugins } = require('../src/plugins/main-composition')
const { resolveConfigPath } = require('../src/plugin-config')
const { posixOnlyReason } = require('./not-ported')
const { createNativePluginStore } = require('../src/native-plugin-store')
const { readNativeKeyring } = require('../src/native-plugin-policy')
const { resolveShellHost } = require('../src/platform')
const { wait } = require('./helpers/hydra-wire-lifecycle')

for (const omitPage of [false, true]) {
  test(omitPage ? 'production Pi default mount guard rejects a missing signed Page definition'
    : 'actual Main bootstrap preserves independent Pi signed revisions and preload consumers',
    { timeout: 240000, skip: posixOnlyReason('unix-socket') }, async t => {
      const fixture = path.join(__dirname, 'pi-main-bootstrap.cjs')
      await fs.access(fixture)
      const root = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'odk-pi-main-'))
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
        'hosted-sessions': { ok: true, sessions: [{ ...sessions[0], hostedPi: true, status: 'settled', latestGoal: 'Hosted priority', updatedAt: 1 }], scannedAt: 1700000000000 },
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
            assert.deepEqual(record, { v: 1, type: 'subscribe-completions' })
            socket.write(JSON.stringify({ v: 1, type: 'completion' }) + '\n')
            return
          }
          assert.ok(Object.hasOwn(replies, record.type))
          socket.end(JSON.stringify(replies[record.type]) + '\n')
        })
      })
      const env = { ...process.env, ODK_CONFIG_DIR: path.join(root, 'config'),
        XDG_STATE_HOME: path.join(root, 'state'), LOCALAPPDATA: path.join(root, 'state'),
        XDG_RUNTIME_DIR: path.join(root, 'runtime'), ODK_WORKSPACE: path.join(root, 'workspace'), ODK_PI_MAIN_ROOT: root,
        ODK_SHELL_TEST_MODE: '1', ODK_LINK_SOCKET: endpoint,
        ODK_SHELL_KIOSK: '0', ODK_SHELL_WIDTH: '1920', ODK_SHELL_HEIGHT: '1280' }
      env.ODK_DISABLED_PLUGINS = ''
      try {
        await fs.mkdir(env.XDG_RUNTIME_DIR, { mode: 0o700 })
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(endpoint, resolve) })
        const native = await install(root, env, { sessions: true, signal: t.signal })
        const views = await installPiViews(root, env, { signal: t.signal, omitPage })
        const viewIds = ['odk.app.pi-sessions', 'odk.page.pi-sessions']
        const viewStore = createNativePluginStore({ stateDir: path.join(resolveShellHost({ env }).stateDir, 'plugins/native'),
          keyring: await readNativeKeyring(views.keyring) })
        const viewFirst = viewIds.map(id => native.config().plugins[id].native.revision)
        const viewFirstSnapshots = await Promise.all(viewFirst.map(revision => viewStore.snapshot(revision)))
        const viewPeers = () => Object.fromEntries(Object.entries(native.config().plugins).filter(([id]) => !viewIds.includes(id)))
        const pids = new Set()
        let viewBaseline
        const launch = async version => {
          const requestOffset = requests.length
          const profile = await fs.mkdtemp(path.join(root, 'electron-'))
          const childEnv = { ...env, ODK_PI_BOOTSTRAP_PROFILE: profile, ODK_PI_BOOTSTRAP_VERSION: version }
          delete childEnv.ELECTRON_RUN_AS_NODE
          const operation = execFile(require('electron'), [`--user-data-dir=${profile}`, fixture], {
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
            assert.deepEqual(report.consumer.sessions.completionNotifications, { state: 'live' })
            assert.equal(report.mainPlugins, createMainPlugins().length)
            assert.equal(report.version, version)
            assert.deepEqual(report.executedVersions, [version, version])
            assert.deepEqual(report.defaultConstructions, { sessions: version === '1.0.0' ? 1 : 0, events: version === '1.0.0' ? 1 : 0 })
            assert.equal(report.handlersReleased, true)
            assert.equal(report.hidden, true)
            assert.deepEqual(report.viewVersions, [version, version])
            assert.equal(report.defaultViewMounts, 0)
            assert.equal(report.themeChecks, 3)
            assert.equal(report.runtimeChanges, version === '1.0.0' ? 0 : 4)
            assert.equal(report.protocolReleased, true)
            if (!viewBaseline) viewBaseline = report.viewConsumers
            else assert.deepEqual(report.viewConsumers, viewBaseline)
            return report.consumer
          } finally {
            await closed
            await wait(Promise.all(closures), t.signal)
            assert.equal(sockets.size, 0, 'Each Main process must release its request and completion subscription connections')
            assert.equal(requests.slice(requestOffset).filter(record => record.type === 'subscribe-completions').length, 1, 'Each Main process owns exactly one completion subscription')
            await fs.rm(profile, { recursive: true, force: true })
          }
        }
        if (omitPage) {
          await assert.rejects(launch('2.0.0'), /Production Pi default mount guard must execute before startup/)
          return
        }
        const ids = ['odk.source.pi-sessions', 'odk.source.pi-events']
        const first = ids.map(id => native.config().plugins[id].native.revision)
        const firstSnapshots = await Promise.all(first.map(revision => native.store.snapshot(revision)))
        const consumer = await launch('2.0.0')
        const updated = ids.map(id => native.bundle(id, '3.0.0'))
        for (let index = 0; index < ids.length; index++) {
          const id = ids[index]
          await native.command(['update', id, updated[index], '--keyring', native.keyring,
            '--trust', '--grant', id.replace('odk.', ''), '--grant', 'ipc'])
        }
        const second = ids.map(id => native.config().plugins[id].native.revision)
        const secondSnapshots = await Promise.all(second.map(revision => native.store.snapshot(revision)))
        first.forEach((revision, index) => assert.notEqual(revision, second[index]))
        const viewUpdated = ['app', 'page'].map(kind => views.bundle(kind, '3.0.0'))
        const peersBeforeUpdate = viewPeers()
        for (let index = 0; index < viewIds.length; index++) await native.command(['update', viewIds[index], viewUpdated[index],
          '--keyring', views.keyring, '--trust'])
        assert.deepEqual(viewPeers(), peersBeforeUpdate)
        const viewSecond = viewIds.map(id => native.config().plugins[id].native.revision)
        const viewSecondSnapshots = await Promise.all(viewSecond.map(revision => viewStore.snapshot(revision)))
        viewFirst.forEach((revision, index) => assert.notEqual(revision, viewSecond[index]))
        assert.deepEqual(await launch('3.0.0'), consumer)
        for (let index = 0; index < viewIds.length; index++) {
          const bytes = await fs.readFile(resolveConfigPath(env))
          await fs.appendFile(path.join(viewUpdated[index], 'entry.js'), '\nthrow Error("Unsigned Pi view update")')
          await assert.rejects(native.command(['update', viewIds[index], viewUpdated[index], '--keyring', views.keyring, '--trust']), /native file hash mismatch/)
          assert.deepEqual(await fs.readFile(resolveConfigPath(env)), bytes)
        }
        for (let index = 0; index < ids.length; index++) {
          const bytes = await fs.readFile(resolveConfigPath(env))
          await fs.appendFile(path.join(updated[index], 'entry.cjs'), '\nthrow Error("Unsigned Pi update")')
          const id = ids[index]
          await assert.rejects(native.command(['update', id, updated[index], '--keyring', native.keyring,
            '--trust', '--grant', id.replace('odk.', ''), '--grant', 'ipc']), /native file hash mismatch/)
          assert.deepEqual(await fs.readFile(resolveConfigPath(env)), bytes)
        }
        for (let index = 0; index < ids.length; index++) {
          await native.command(['rollback', ids[index], '--keyring', native.keyring])
          assert.equal(native.config().plugins[ids[index]].native.revision, first[index])
        }
        const peersBeforeRollback = viewPeers()
        for (let index = 0; index < viewIds.length; index++) {
          await native.command(['rollback', viewIds[index], '--keyring', views.keyring])
          assert.equal(native.config().plugins[viewIds[index]].native.revision, viewFirst[index])
        }
        assert.deepEqual(viewPeers(), peersBeforeRollback)
        assert.deepEqual(await launch('2.0.0'), consumer)
        for (const id of ids) await native.command(['remove', id])
        const peersBeforeRemoval = viewPeers()
        for (const id of viewIds) await native.command(['remove', id])
        assert.deepEqual(viewPeers(), peersBeforeRemoval)
        assert.deepEqual(await launch('1.0.0'), consumer)
        assert.equal(pids.size, 4)
        for (let index = 0; index < ids.length; index++) {
          assert.deepEqual([...(await native.store.snapshot(first[index])).files], [...firstSnapshots[index].files])
          assert.deepEqual([...(await native.store.snapshot(second[index])).files], [...secondSnapshots[index].files])
        }
        for (let index = 0; index < viewIds.length; index++) {
          assert.deepEqual([...(await viewStore.snapshot(viewFirst[index])).files], [...viewFirstSnapshots[index].files])
          assert.deepEqual([...(await viewStore.snapshot(viewSecond[index])).files], [...viewSecondSnapshots[index].files])
        }
        assert.equal(consumer.sessions.sessions.length, 1)
        assert.equal(consumer.sessions.sessions[0].latestGoal, 'Hosted priority')
        assert.equal(consumer.sessions.sessions[0].hostedPi, true)
        assert.equal(consumer.sessions.summary.running, 0)
        assert.equal(consumer.sessions.summary.settled, 1)
        assert.deepEqual(consumer.events, { ok: true, events: [{ kind: 'assistant', text: 'Reported event' }], truncated: true })
        assert.ok(['machines', 'hosted-sessions', 'snapshot', 'events'].every(type => requests.some(record => record.type === type)))
        assert.ok(requests.some(record => record.type === 'events' && record.sessionId === 'fixture' && record.hostedPi === true))
      } finally {
        for (const socket of sockets) socket.destroy()
        if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        await fs.rm(root, { recursive: true, force: true })
      }
    })
}
