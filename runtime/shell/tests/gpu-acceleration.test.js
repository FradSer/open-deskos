const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
const { configureGpuSwitches, resolveGpuBackend } = require('../src/main')

const BASE_SWITCHES = ['ignore-gpu-blocklist', 'enable-gpu-rasterization', 'enable-zero-copy']
const MALI_SWITCHES = [...BASE_SWITCHES, 'use-gl', 'use-angle', 'disable-gpu-compositing']

function mockApp() {
  const switches = []
  return {
    switches,
    commandLine: {
      appendSwitch: (key, val) => switches.push({ key, val }),
    },
  }
}

test('main process configures GPU acceleration flags for Chromium/Electron', () => {
  assert.match(mainSource, /configureGpuSwitches/)
  assert.match(mainSource, /ignore-gpu-blocklist/)
  assert.match(mainSource, /enable-gpu-rasterization/)
  assert.match(mainSource, /enable-zero-copy/)
  assert.match(mainSource, /use-angle'?, ?'gles-egl'/)
  assert.match(mainSource, /disable-gpu-compositing/)
})

test('configureGpuSwitches enables the Mali backend on a CM5 X11 session', () => {
  const { switches, commandLine } = mockApp()
  const result = configureGpuSwitches({ commandLine }, { DISPLAY: ':0' }, {
    platform: 'linux',
    arch: 'arm64',
    maliUserspacePresent: true,
  })

  assert.equal(result.hardwareAcceleration, true)
  assert.equal(result.backend, 'mali')
  assert.deepEqual(switches.map((s) => s.key), MALI_SWITCHES)
  assert.deepEqual(
    switches.filter((s) => s.val !== undefined),
    [
      { key: 'use-gl', val: 'angle' },
      { key: 'use-angle', val: 'gles-egl' },
    ],
  )
})

test('configureGpuSwitches keeps the default backend without the Mali userspace blob', () => {
  const { switches, commandLine } = mockApp()
  const result = configureGpuSwitches({ commandLine }, { DISPLAY: ':0' }, {
    platform: 'linux',
    arch: 'arm64',
    maliUserspacePresent: false,
  })

  assert.equal(result.hardwareAcceleration, true)
  assert.equal(result.backend, 'default')
  assert.deepEqual(switches.map((s) => s.key), BASE_SWITCHES)
})

test('configureGpuSwitches keeps the default backend on non-CM5 hosts', () => {
  const { switches, commandLine } = mockApp()
  const result = configureGpuSwitches({ commandLine }, {}, {
    platform: 'darwin',
    arch: 'arm64',
    maliUserspacePresent: true,
  })

  assert.equal(result.backend, 'default')
  assert.deepEqual(switches.map((s) => s.key), BASE_SWITCHES)
})

test('configureGpuSwitches leaves a Wayland session on the default backend', () => {
  const { commandLine } = mockApp()
  const result = configureGpuSwitches({ commandLine }, { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }, {
    platform: 'linux',
    arch: 'arm64',
    maliUserspacePresent: true,
  })

  assert.equal(result.backend, 'default')
})

test('configureGpuSwitches honours an explicit ODESK_GPU_BACKEND override', () => {
  const forced = mockApp()
  const forcedResult = configureGpuSwitches({ commandLine: forced.commandLine }, { ODESK_GPU_BACKEND: 'mali' }, {
    platform: 'darwin',
    arch: 'arm64',
    maliUserspacePresent: false,
  })
  assert.equal(forcedResult.backend, 'mali')
  assert.deepEqual(forced.switches.map((s) => s.key), MALI_SWITCHES)

  const defaulted = mockApp()
  const defaultedResult = configureGpuSwitches({ commandLine: defaulted.commandLine }, { ODESK_GPU_BACKEND: 'default', DISPLAY: ':0' }, {
    platform: 'linux',
    arch: 'arm64',
    maliUserspacePresent: true,
  })
  assert.equal(defaultedResult.backend, 'default')
  assert.deepEqual(defaulted.switches.map((s) => s.key), BASE_SWITCHES)
})

test('configureGpuSwitches respects ODESK_DISABLE_GPU and LIBGL_ALWAYS_SOFTWARE=1 fallback', () => {
  const softwareOptions = { platform: 'linux', arch: 'arm64', maliUserspacePresent: true }

  const first = mockApp()
  const firstResult = configureGpuSwitches({ commandLine: first.commandLine }, { ODESK_DISABLE_GPU: '1', DISPLAY: ':0' }, softwareOptions)
  assert.equal(firstResult.hardwareAcceleration, false)
  assert.equal(firstResult.backend, 'software')
  assert.deepEqual(first.switches.map((s) => s.key), ['disable-gpu'])

  const second = mockApp()
  const secondResult = configureGpuSwitches({ commandLine: second.commandLine }, { LIBGL_ALWAYS_SOFTWARE: '1', DISPLAY: ':0' }, softwareOptions)
  assert.equal(secondResult.hardwareAcceleration, false)
  assert.equal(secondResult.backend, 'software')
  assert.deepEqual(second.switches.map((s) => s.key), ['disable-gpu'])
})

test('resolveGpuBackend requires linux arm64, the userspace blob, and an X11 session', () => {
  const base = { platform: 'linux', arch: 'arm64', maliUserspacePresent: true }
  assert.equal(resolveGpuBackend({ DISPLAY: ':0' }, base), 'mali')
  assert.equal(resolveGpuBackend({ DISPLAY: ':0' }, { ...base, maliUserspacePresent: false }), 'default')
  assert.equal(resolveGpuBackend({ DISPLAY: ':0' }, { ...base, arch: 'x64' }), 'default')
  assert.equal(resolveGpuBackend({ DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' }, base), 'default')
  assert.equal(resolveGpuBackend({}, base), 'default')
  assert.equal(resolveGpuBackend({ ODESK_GPU_BACKEND: 'mali' }, { platform: 'darwin', arch: 'arm64' }), 'mali')
})