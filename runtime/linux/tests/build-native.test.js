const test = require('node:test')
const assert = require('node:assert/strict')

const loadPlan = async () => (await import('../scripts/build-native.mjs')).resolveNativeBuildPlan

test('the native reader is not built off Windows, and says so', async () => {
  const resolveNativeBuildPlan = await loadPlan()

  for (const platform of ['darwin', 'linux']) {
    const plan = resolveNativeBuildPlan({ platform, arch: 'arm64', electronVersion: '43.4.1' })
    assert.equal(plan.skip, true, platform)
    assert.match(plan.reason, /Windows/)
    assert.equal(plan.command, null)
  }
})

test('a Windows x64 host builds the reader against Electron headers', async () => {
  const resolveNativeBuildPlan = await loadPlan()
  const plan = resolveNativeBuildPlan({ platform: 'win32', arch: 'x64', electronVersion: '43.4.1' })

  assert.equal(plan.skip, false)
  assert.equal(plan.reason, '')
  assert.equal(plan.command, 'node-gyp')
  for (const expected of [
    'rebuild',
    '--runtime=electron',
    '--target=43.4.1',
    '--arch=x64',
    '--dist-url=https://electronjs.org/headers',
  ]) {
    assert.ok(plan.args.includes(expected), `missing ${expected}`)
  }
  assert.ok(plan.args.some((arg) => arg.startsWith('--directory=') && arg.endsWith('odk-process')), 'builds this addon only')
  assert.ok(plan.cwd.endsWith('runtime/linux') || plan.cwd.endsWith('runtime\\linux'), 'runs from the runtime root')
})

test('a Windows build without a known Electron version is refused instead of guessed', async () => {
  const resolveNativeBuildPlan = await loadPlan()
  const plan = resolveNativeBuildPlan({ platform: 'win32', arch: 'x64', electronVersion: '' })

  assert.equal(plan.skip, true)
  assert.match(plan.reason, /Electron/)
  assert.equal(plan.command, null)
})

// Loading is the half of "built" that a successful compile does not prove: an
// addon built without Electron's delay-load hook compiles and then refuses to
// load with "Module did not self-register".
test('the built reader is loaded inside Electron before the build is called good', async () => {
  const { resolveNativeLoadCheck } = await import('../scripts/build-native.mjs')

  const off = resolveNativeLoadCheck({ platform: 'darwin' })
  assert.equal(off.skip, true)
  assert.match(off.reason, /Windows/)

  const check = resolveNativeLoadCheck({ platform: 'win32', root: 'C:\\repo\\runtime\\linux' })
  assert.equal(check.skip, false)
  assert.equal(check.env.ELECTRON_RUN_AS_NODE, '1', 'the check must run in Electron, not in plain Node')
  assert.ok(check.command.includes('electron'), check.command)
  assert.ok(check.args.some((arg) => arg.includes('odk_process.node')), 'the check must load the artifact that was just built')
})