import { test } from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hostDirectories, prepareHostDirectories } from '../src/host-paths.mjs'

// A Windows host has no runtime directory for the control socket to create, so
// the service has to create the directory it writes in itself. That is a fact a
// device found by exiting at startup, and this is what keeps it from returning.
test('a Windows host keeps captures and agent state in its own application data', () => {
  assert.deepEqual(hostDirectories({ LOCALAPPDATA: 'C:\\Users\\desk\\AppData\\Local' }, 'win32'), {
    captures: join('C:\\Users\\desk\\AppData\\Local', 'odk', 'personal-agent'),
    state: join('C:\\Users\\desk\\AppData\\Local', 'odk', 'personal-agent'),
  })
})

test('a Unix host keeps captures in the runtime directory and state where XDG says', () => {
  assert.deepEqual(hostDirectories({ XDG_RUNTIME_DIR: '/run/user/1000', XDG_STATE_HOME: '/home/kiosk/.local/state' }, 'linux'), {
    captures: join('/run/user/1000','odk-personal-agent'),
    state: join('/home/kiosk/.local/state','odk-personal-agent'),
  })
})

test('a missing host directory is created before anything is written into it', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-host-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const captures = join(dir, 'app-data', 'odk', 'personal-agent')
  assert.equal(await access(captures).then(() => true, () => false), false)

  const directories = await prepareHostDirectories({ LOCALAPPDATA: join(dir, 'app-data') }, 'win32')

  assert.equal(directories.captures, captures)
  assert.deepEqual(await readdir(captures), [])
  await access(captures)
})

test('a host that cannot hold the directory stops startup instead of recording nowhere', async () => {
  await assert.rejects(prepareHostDirectories({}, 'win32', async () => { throw Object.assign(Error('no space'), { code: 'ENOSPC' }) }),
    { message: 'no space' })
  // A Unix host creates one directory when both roles share it, not two.
  const created = []
  await prepareHostDirectories({ XDG_RUNTIME_DIR: '/run/user/1000', XDG_STATE_HOME: '/run/user/1000/state' }, 'linux',
    async (directory, options) => { created.push([directory, options]) })
  assert.deepEqual(created.map(([directory]) => directory), [join('/run/user/1000','odk-personal-agent'), join('/run/user/1000/state','odk-personal-agent')])
  assert.deepEqual(created[0][1], { recursive: true, mode: 0o700 })
})
