#!/usr/bin/env node
const path = require('node:path')
const { validateRuntimeComposition } = require('./lib/runtime-release')

const releasePath = process.argv[2]
if (!releasePath) {
  console.error('release path is required')
  process.exitCode = 1
} else {
  const result = validateRuntimeComposition(path.resolve(releasePath))
  if (!result.ok) {
    console.error(`Open DeskOS release validation failed: ${result.reason}`)
    process.exitCode = 1
  }
}
