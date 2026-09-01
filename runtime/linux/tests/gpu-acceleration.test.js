const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const mainSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')
const { configureGpuSwitches } = require('../src/main')

test('main process configures GPU acceleration flags for Chromium/Electron', () => {
  assert.match(mainSource, /configureGpuSwitches/)
  assert.match(mainSource, /ignore-gpu-blocklist/)
  assert.match(mainSource, /enable-gpu-rasterization/)
  assert.match(mainSource, /enable-zero-copy/)
})

test('configureGpuSwitches enables hardware acceleration by default', () => {
  const switches = []
  const mockApp = {
    commandLine: {
      appendSwitch: (key, val) => switches.push({ key, val }),
    },
  }

  const result = configureGpuSwitches(mockApp, {})
  assert.equal(result.hardwareAcceleration, true)
  assert.deepEqual(switches.map((s) => s.key), [
    'ignore-gpu-blocklist',
    'enable-gpu-rasterization',
    'enable-zero-copy',
  ])
})

test('configureGpuSwitches respects ODESK_DISABLE_GPU and LIBGL_ALWAYS_SOFTWARE=1 fallback', () => {
  const switches1 = []
  const mockApp1 = {
    commandLine: {
      appendSwitch: (key, val) => switches1.push({ key, val }),
    },
  }
  const result1 = configureGpuSwitches(mockApp1, { ODESK_DISABLE_GPU: '1' })
  assert.equal(result1.hardwareAcceleration, false)
  assert.deepEqual(switches1.map((s) => s.key), ['disable-gpu'])

  const switches2 = []
  const mockApp2 = {
    commandLine: {
      appendSwitch: (key, val) => switches2.push({ key, val }),
    },
  }
  const result2 = configureGpuSwitches(mockApp2, { LIBGL_ALWAYS_SOFTWARE: '1' })
  assert.equal(result2.hardwareAcceleration, false)
  assert.deepEqual(switches2.map((s) => s.key), ['disable-gpu'])
})

test('configureGpuSwitches configures EGL when requested or running under Wayland', () => {
  const switches = []
  const mockApp = {
    commandLine: {
      appendSwitch: (key, val) => switches.push({ key, val }),
    },
  }
  const result = configureGpuSwitches(mockApp, { WAYLAND_DISPLAY: 'wayland-0' })
  assert.equal(result.hardwareAcceleration, true)
  assert.ok(switches.some((s) => s.key === 'use-gl' && s.val === 'egl'))
})
