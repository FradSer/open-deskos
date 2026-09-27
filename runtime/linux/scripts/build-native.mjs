#!/usr/bin/env node
// Build the optional Windows process reader.
//
// The reader is the only place the desk reads another process's work directory,
// and it exists only on a Windows host. This script is a no-op everywhere else,
// so a development machine and the reference host never need a C++ toolchain.

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ADDON_DIRECTORY = path.join('native', 'odk-process')
const ELECTRON_HEADERS = 'https://electronjs.org/headers'

function installedElectronVersion(root = RUNTIME_ROOT) {
  try {
    const manifest = JSON.parse(readFileSync(path.join(root, 'node_modules', 'electron', 'package.json'), 'utf8'))
    return typeof manifest.version === 'string' ? manifest.version : ''
  } catch {
    return ''
  }
}

/**
 * Decide what to build, and against which ABI. The reader is loaded by the
 * Electron main process, so it is built for Electron rather than for the Node
 * version a shell happens to have on PATH.
 */
export function resolveNativeBuildPlan({
  platform = process.platform,
  arch = process.arch,
  electronVersion = installedElectronVersion(),
  runtimeRoot = RUNTIME_ROOT,
} = {}) {
  if (platform !== 'win32') {
    return {
      skip: true,
      reason: 'the Windows process reader is Windows-only; nothing to build on this host',
      command: null,
      args: [],
      cwd: runtimeRoot,
    }
  }
  if (!electronVersion) {
    return {
      skip: true,
      reason: 'Electron is not installed, so there is no Electron ABI to build against',
      command: null,
      args: [],
      cwd: runtimeRoot,
    }
  }
  return {
    skip: false,
    reason: '',
    command: 'node-gyp',
    args: [
      'rebuild',
      `--directory=${ADDON_DIRECTORY}`,
      '--runtime=electron',
      `--target=${electronVersion}`,
      `--arch=${arch}`,
      `--dist-url=${ELECTRON_HEADERS}`,
    ],
    cwd: runtimeRoot,
  }
}

/**
 * Loading is the half of "built" a successful compile does not prove: on Windows an
 * addon built without Electron's delay-load hook compiles and then refuses to load
 * with "Module did not self-register". The check runs the artifact inside Electron's
 * own Node, which is the process that will load it at runtime.
 */
export function resolveNativeLoadCheck({ platform = process.platform, root = RUNTIME_ROOT } = {}) {
  if (platform !== 'win32') {
    return { skip: true, reason: 'the Windows process reader is Windows-only; nothing to load here', command: null, args: [], env: {}, cwd: root }
  }
  return {
    skip: false,
    reason: '',
    command: path.join(root, 'node_modules', '.bin', 'electron.cmd'),
    args: [
      '-e',
      "const reader = require('./native/odk-process/build/Release/odk_process.node');"
        + "const rows = reader.listProcesses();"
        + "console.log('process reader loaded; rows=' + rows.length + ' sample=' + JSON.stringify(rows[0] || null))",
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
    cwd: root,
  }
}

function main() {
  const plan = resolveNativeBuildPlan()
  if (plan.skip) {
    console.log(`native process reader: ${plan.reason}`)
    return 0
  }

  console.log(`native process reader: ${plan.command} ${plan.args.join(' ')}`)
  const result = spawnSync(plan.command, plan.args, {
    cwd: plan.cwd,
    stdio: 'inherit',
    // node-gyp is a Windows shim, so the lookup needs a shell there.
    shell: plan.command === 'node-gyp' && process.platform === 'win32',
  })
  if (result.error || result.status !== 0) {
    console.error('native process reader: build failed.')
    console.error('The desk still starts and states session work directories as unknown; run this again after installing the C++ build tools.')
    return 1
  }

  // A build that does not load is not a working reader, and the desk would report
  // every work directory as unknown without saying why.
  const check = resolveNativeLoadCheck()
  if (!check.skip) {
    const loaded = spawnSync(check.command, check.args, {
      cwd: check.cwd,
      encoding: 'utf8',
      env: { ...process.env, ...check.env },
      shell: process.platform === 'win32',
    })
    const output = `${loaded.stdout || ''}${loaded.stderr || ''}`.trim().split('\n').pop() || ''
    if (loaded.status !== 0 || !output.includes('process reader loaded')) {
      console.error('native process reader: built but it does not load in Electron.')
      console.error(`  ${output}`)
      console.error('A module that fails to load here usually lacks the delay-load hook: keep win_delay_load_hook true in binding.gyp.')
      console.error('The desk still starts and states session work directories as unknown.')
      return 1
    }
    console.log(`native process reader: ${output}`)
  }

  console.log(`native process reader: built ${path.join(plan.cwd, ADDON_DIRECTORY, 'build', 'Release', 'odk_process.node')}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}