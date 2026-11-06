#!/usr/bin/env node
// Proves the built Android host answers the HOME intent.
//
// Run it after `./gradlew assembleDebug`. It reads the merged manifest and the
// APK badging, and fails before any device step when the app cannot become the
// default Home app. It also runs a negative control, so a check that always
// passes cannot stand in for the declaration.
//
// Usage: node scripts/check-home-declaration.mjs
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT ||
  '/opt/homebrew/share/android-commandlinetools'
const aapt = path.join(sdk, 'build-tools/34.0.0/aapt')
const merged = path.join(root, 'app/build/intermediates/merged_manifests/debug/processDebugManifest/AndroidManifest.xml')
const apk = path.join(root, 'app/build/outputs/apk/debug/app-debug.apk')

const MAIN = 'android.intent.action.MAIN'
const HOME = 'android.intent.category.HOME'
const DEFAULT = 'android.intent.category.DEFAULT'
const LAUNCHER = 'android.intent.category.LAUNCHER'
const ACTIVITY = 'com.odk.shell.ShellActivity'

function homeCategories(manifest) {
  const filters = [...manifest.matchAll(/<intent-filter\b[^>]*>([\s\S]*?)<\/intent-filter>/g)]
    .map((match) => match[1])
  return filters.map((body) => ({
    main: body.includes(MAIN),
    home: body.includes(HOME),
    default: body.includes(DEFAULT),
    launcher: body.includes(LAUNCHER),
  }))
}

function assertHome(manifest, label) {
  const findings = []
  const filters = homeCategories(manifest)
  const homes = filters.filter((entry) => entry.home)
  if (homes.length !== 1) findings.push(label + ' declares ' + homes.length + ' HOME filters, expected one')
  if (!homes.some((entry) => entry.main && entry.home && entry.default)) {
    findings.push(label + ' has no MAIN + HOME + DEFAULT intent filter')
  }
  if (!filters.some((entry) => entry.main && entry.launcher)) {
    findings.push(label + ' has no MAIN + LAUNCHER intent filter')
  }
  return findings
}

const findings = []
let manifest
try {
  manifest = readFileSync(merged, 'utf8')
} catch {
  findings.push('merged manifest missing; run ./gradlew assembleDebug first: ' + merged)
}
if (manifest) findings.push(...assertHome(manifest, 'merged manifest'))

// Negative control: the check must reject the original LAUNCHER-only manifest.
const original = '<manifest><application><activity android:name=".ShellActivity">' +
  '<intent-filter><action android:name="' + MAIN + '"/>' +
  '<category android:name="' + LAUNCHER + '"/></intent-filter></activity></application></manifest>'
if (assertHome(original, 'negative control').length === 0) {
  findings.push('the declaration check accepts a LAUNCHER-only manifest')
}

try {
  const badging = execFileSync(aapt, ['dump', 'badging', apk], { encoding: 'utf8' })
  if (!badging.includes('launchable-activity: name=\'' + ACTIVITY + '\'')) {
    findings.push('APK launchable activity is not ' + ACTIVITY)
  }
} catch (error) {
  findings.push('APK badging unreadable; run ./gradlew assembleDebug first: ' + error.message)
}

for (const finding of findings) console.log('FAIL ' + finding)
console.log('HOME_DECLARATION findings=' + findings.length)
process.exit(findings.length === 0 ? 0 : 1)
