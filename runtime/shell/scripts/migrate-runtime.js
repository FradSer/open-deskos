#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { migrateUser } = require('./lib/runtime-release')

function runtimePaths(root) {
  const stateDir = path.join(root, 'state')
  return {
    root,
    stateDir,
    releasesDir: path.join(root, 'releases'),
    activeLink: path.join(root, 'current'),
    rollbackLink: path.join(root, 'previous'),
    lockPath: path.join(stateDir, 'update.lock'),
  }
}

function environment(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

function main() {
  const runtime = runtimePaths(path.resolve(environment('ODK_RUNTIME_ROOT')))
  const user = environment('ODK_KIOSK_USER')
  const migrations = [
    {
      id: '001-runtime-state',
      run: ({ stateDir }) => fs.mkdirSync(path.join(stateDir, 'migrations'), { recursive: true }),
    },
  ]
  const completed = migrateUser({ runtime, user, migrations })
  console.log(JSON.stringify({ ok: true, completed }))
}

try {
  main()
} catch (error) {
  console.error(`Open DeskOS migration failed: ${error.message}`)
  process.exitCode = 1
}
