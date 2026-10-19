#!/usr/bin/env node
// Proves the renderer the APK carries is the shared renderer, byte for byte.
//
// Run it after `./gradlew assembleDebug`, with the staged tree in place. It fails
// when a staged file differs from `runtime/shell/src`, when one is missing, or
// when the staged tree adds a file of its own: an Android renderer copy is what
// ADR-0037 forbids.
//
// Usage: node scripts/check-staged-renderer.mjs
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const shellSource = path.resolve(here, '../../shell/src')
const stagedRoot = path.resolve(here, '../app/build/staged-assets')
const stagedWeb = path.join(stagedRoot, 'web')

// The renderer's own dependency libraries arrive from the Shell's install, and
// the generated Liquid Glass bundle is not part of the staged tree.
const IGNORED = new Set(['renderer/themes/liquid-glass-sdk.js'])

function filesUnder(root, prefix = '') {
  const found = []
  for (const entry of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix ? path.join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) found.push(...filesUnder(root, relative))
    else found.push(relative.split(path.sep).join('/'))
  }
  return found
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

const sourceFiles = ['plugin-host.js', ...filesUnder(shellSource, 'renderer').map((value) => 'renderer/' + value.replace(/^renderer\//, ''))]
  .filter((value) => !IGNORED.has(value))
const stagedFiles = filesUnder(stagedWeb)

const findings = []
for (const relative of sourceFiles) {
  const source = path.join(shellSource, relative)
  const staged = path.join(stagedWeb, relative)
  try {
    if (!statSync(staged).isFile()) findings.push('missing from the APK asset tree: ' + relative)
    else if (digest(source) !== digest(staged)) findings.push('differs from the shared renderer: ' + relative)
  } catch {
    findings.push('missing from the APK asset tree: ' + relative)
  }
}
for (const relative of stagedFiles) {
  if (!sourceFiles.includes(relative)) findings.push('staged file the shared renderer does not have: ' + relative)
}

for (const finding of findings.slice(0, 20)) console.log('FAIL ' + finding)
console.log('STAGED_RENDERER files=' + sourceFiles.length + ' staged=' + stagedFiles.length + ' findings=' + findings.length)
process.exit(findings.length === 0 ? 0 : 1)