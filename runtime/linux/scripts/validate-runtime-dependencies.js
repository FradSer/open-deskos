#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const app = process.versions.electron && process.type === 'browser' ? require('electron').app : null

function validateModuleTree(loaded, releasePath, seen = new Set()) {
  if (seen.has(loaded)) return
  seen.add(loaded)
  const filename = fs.realpathSync(loaded.filename)
  if (!filename.startsWith(`${releasePath}${path.sep}`)) {
    throw new Error(`${filename} resolves outside the candidate release`)
  }
  for (const child of loaded.children) validateModuleTree(child, releasePath, seen)
}

try {
  if (!process.argv[2]) throw new Error('release path is required')
  const releasePath = fs.realpathSync(process.argv[2])
  const manifestPath = path.join(releasePath, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const requireFromRelease = createRequire(manifestPath)
  for (const name of Object.keys(manifest.dependencies || {})) {
    const entry = requireFromRelease.resolve(name)
    if (!entry.startsWith(`${releasePath}${path.sep}`)) {
      throw new Error(`${name} resolves outside the candidate release: ${entry}`)
    }
    requireFromRelease(name)
    validateModuleTree(requireFromRelease.cache[entry], releasePath)
  }
} catch (error) {
  console.error(`Open DeskOS runtime dependency validation failed: ${error.message}`)
  process.exitCode = 1
}

if (app) app.exit(process.exitCode || 0)
