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

function findPackageManifest(requireFromRelease, name) {
  for (const modulesPath of requireFromRelease.resolve.paths(name) || []) {
    const manifestPath = path.join(modulesPath, ...name.split('/'), 'package.json')
    try {
      return fs.realpathSync(manifestPath)
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
    }
  }
  return null
}

function importTargets(exportsMap) {
  const targets = []
  function visit(value, isImportTarget = false) {
    if (typeof value === 'string') {
      if (isImportTarget && value.startsWith('./')) targets.push(value)
      return
    }
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) {
      for (const item of value) visit(item, isImportTarget)
      return
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'import') visit(child, true)
      else if (key.startsWith('.')) visit(child)
      else if (isImportTarget) visit(child, true)
    }
  }
  visit(exportsMap)
  return [...new Set(targets)]
}

function resolveImportOnlyAsset(requireFromRelease, name) {
  const manifestPath = findPackageManifest(requireFromRelease, name)
  if (!manifestPath) return null
  const packageManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const targets = importTargets(packageManifest.exports)
  if (targets.length === 0) return null
  const packagePath = path.dirname(manifestPath)
  for (const target of targets) {
    const resolved = fs.realpathSync(path.resolve(packagePath, target))
    if (!resolved.startsWith(`${packagePath}${path.sep}`) && resolved !== packagePath) {
      throw new Error(`${name} import export resolves outside its package: ${resolved}`)
    }
  }
  return { kind: 'asset', entry: manifestPath }
}

function resolveDependency(requireFromRelease, name) {
  try {
    return { kind: 'module', entry: requireFromRelease.resolve(name) }
  } catch (error) {
    if (error?.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && error?.code !== 'MODULE_NOT_FOUND') throw error
    // Asset-only packages (for example @highlightjs/cdn-assets, which the
    // renderer loads with a script tag) declare no main or exports, so they can
    // never be required as a module. Only their location remains checkable.
    try {
      return { kind: 'asset', entry: requireFromRelease.resolve(`${name}/package.json`) }
    } catch {
      const importOnlyAsset = resolveImportOnlyAsset(requireFromRelease, name)
      if (importOnlyAsset) return importOnlyAsset
      throw error
    }
  }
}

try {
  if (!process.argv[2]) throw new Error('release path is required')
  const releasePath = fs.realpathSync(process.argv[2])
  const manifestPath = path.join(releasePath, 'package.json')
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const requireFromRelease = createRequire(manifestPath)
  for (const name of Object.keys(manifest.dependencies || {})) {
    const { kind, entry } = resolveDependency(requireFromRelease, name)
    if (!entry.startsWith(`${releasePath}${path.sep}`)) {
      throw new Error(`${name} resolves outside the candidate release: ${entry}`)
    }
    if (kind === 'asset') continue
    requireFromRelease(name)
    validateModuleTree(requireFromRelease.cache[entry], releasePath)
  }
} catch (error) {
  console.error(`Open DeskOS runtime dependency validation failed: ${error.message}`)
  process.exitCode = 1
}

if (app) app.exit(process.exitCode || 0)
