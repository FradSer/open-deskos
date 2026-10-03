const test = require('node:test')
const assert = require('node:assert/strict')

const { createWindowsProcessSource, parseWindowsProcessTable } = require('../src/platform/win32-processes')
const { createNativeProcessReader } = require('../src/platform/native-process-reader')
const { listPiProcesses } = require('../src/pi-sessions')

const NOW = Date.parse('2026-03-01T12:00:00Z')

function managedTable(rows) {
  return JSON.stringify(rows)
}

const PI_ROW = {
  ProcessId: 4120,
  ParentProcessId: 3000,
  Name: 'node.exe',
  CommandLine: '"C:\\Program Files\\nodejs\\node.exe" C:\\tools\\pi.js --continue',
  startedAtMs: NOW - 90_000,
}

test('the managed process table decodes the payload PowerShell projects', () => {
  const rows = parseWindowsProcessTable(managedTable([
    PI_ROW,
    { ProcessId: 5200, ParentProcessId: 4120, Name: 'explorer.exe', CommandLine: 'C:\\Windows\\explorer.exe', startedAtMs: NOW - 4_000 },
  ]), NOW)

  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], {
    pid: 4120,
    ppid: 3000,
    comm: 'node.exe',
    command: '"C:\\Program Files\\nodejs\\node.exe" C:\\tools\\pi.js --continue',
    tokens: ['C:\\Program Files\\nodejs\\node.exe', 'C:\\tools\\pi.js', '--continue'],
    cwd: '',
    startedAt: NOW - 90_000,
    elapsedSeconds: 90,
    isAlive: true,
  })
  assert.equal(rows[1].pid, 5200)
  assert.equal(rows[1].elapsedSeconds, 4)
})

test('a single-process payload decodes as one row', () => {
  const rows = parseWindowsProcessTable(managedTable(PI_ROW), NOW)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].pid, 4120)
  assert.equal(rows[0].tokens[1], 'C:\\tools\\pi.js')
})

test('an unreadable payload decodes as no processes instead of throwing', () => {
  for (const payload of ['', '   ', 'not json', 'null', '{}', null, undefined]) {
    assert.deepEqual(parseWindowsProcessTable(payload, NOW), [], String(payload))
  }
})

test('rows without an identity are skipped and a missing command line stays empty', () => {
  const rows = parseWindowsProcessTable(managedTable([
    { ProcessId: 'nonsense', Name: 'ghost.exe' },
    { ProcessId: 0 },
    { ProcessId: 700, Name: 'System', CommandLine: null },
  ]), NOW)

  assert.equal(rows.length, 1)
  assert.equal(rows[0].pid, 700)
  assert.equal(rows[0].command, '')
  assert.deepEqual(rows[0].tokens, [])
  assert.equal(rows[0].ppid, null)
  assert.equal(rows[0].startedAt, 0)
  assert.equal(rows[0].elapsedSeconds, 0)
})

test('the native reader supplies the work directory when the module loads', () => {
  const source = createWindowsProcessSource({
    loadNative: () => ({ listProcesses: () => [{ pid: 4120, ppid: 3000, exe: 'node.exe', command: 'node C:\\tools\\pi.js', startedAtMs: NOW - 90_000, cwd: 'C:\\work\\desk' }] }),
    readManagedTable: () => managedTable([]),
  })

  assert.equal(source.backend, 'native')
  const rows = source.list(NOW)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].cwd, 'C:\\work\\desk')
  assert.equal(rows[0].elapsedSeconds, 90)
  assert.deepEqual(rows[0].tokens, ['node', 'C:\\tools\\pi.js'])
})

test('an unloadable native module degrades to the managed table with unknown work directories', () => {
  const source = createWindowsProcessSource({
    loadNative: () => null,
    readManagedTable: () => managedTable([PI_ROW]),
  })

  assert.equal(source.backend, 'managed')
  const rows = source.list(NOW)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].pid, 4120)
  // The managed table cannot read another process's directory, so it says so
  // instead of inferring one from the executable or the command line.
  assert.equal(rows[0].cwd, '')
})

test('a process the shell may not read keeps its identity and reports an unknown directory', () => {
  const source = createWindowsProcessSource({
    loadNative: () => ({
      listProcesses: () => [{
        pid: 4120,
        ppid: 3000,
        exe: 'pi.exe',
        command: 'pi --continue',
        startedAtMs: NOW - 30_000,
        // A target at a higher integrity level answers with no directory rather
        // than an error, and the row still states what is known about it.
        cwd: '',
      }],
    }),
    readManagedTable: () => managedTable([]),
  })

  const rows = source.list(NOW)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].pid, 4120)
  assert.equal(rows[0].ppid, 3000)
  assert.equal(rows[0].startedAt, NOW - 30_000)
  assert.equal(rows[0].elapsedSeconds, 30)
  assert.equal(rows[0].cwd, '')
  assert.equal(source.backend, 'native', 'an unreadable target is not a degraded backend')
})

test('a native reader that throws degrades rather than failing the scan', () => {
  const source = createWindowsProcessSource({
    loadNative: () => ({ listProcesses: () => { throw new Error('enumeration refused') } }),
    readManagedTable: () => managedTable([PI_ROW]),
  })

  assert.equal(source.backend, 'native', 'the module loaded, so it is the backend until it refuses')
  const rows = source.list(NOW)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].cwd, '')
  assert.equal(source.backend, 'managed', 'a refused enumeration leaves the degraded backend in place')
  assert.equal(source.list(NOW).length, 1, 'the degraded backend keeps answering')
})

test('the native reader loads only an object that exposes the process list', () => {
  assert.equal(createNativeProcessReader({ requireImpl: () => { throw new Error('not built') } }).reader, null)

  const loaded = createNativeProcessReader({ requireImpl: () => ({ listProcesses: () => [] }) })
  assert.equal(typeof loaded.reader.listProcesses, 'function')
  assert.equal(loaded.reason, '')

  const wrongShape = createNativeProcessReader({ requireImpl: () => ({ listProcesses: 'no' }) })
  assert.equal(wrongShape.reader, null)
  assert.match(wrongShape.reason, /listProcesses/)
})

test('a Windows host scans through the Windows source', () => {
  const calls = []
  const rows = listPiProcesses(NOW, false, {
    host: { isWindows: true, id: 'win32-x64' },
    windowsSource: { backend: 'native', list: (now) => { calls.push(now); return [{ pid: 4120, ppid: 3000, comm: 'node.exe', command: 'node C:\\tools\\pi.js', cwd: 'C:\\work\\desk', startedAt: NOW, elapsedSeconds: 0, isAlive: true }] } },
  })

  assert.deepEqual(calls, [NOW])
  assert.equal(rows[0].cwd, 'C:\\work\\desk')
})

test('a non-Windows host never reads the Windows source', () => {
  let called = false
  listPiProcesses(NOW, false, {
    host: { isWindows: false, id: 'darwin-arm64' },
    windowsSource: { backend: 'native', list: () => { called = true; return [] } },
  })

  assert.equal(called, false)
})