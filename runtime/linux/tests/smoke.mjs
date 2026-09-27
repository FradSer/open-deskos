#!/usr/bin/env node
// The Shell acceptance checks, in Node so every Shell Host can run them: a
// Windows host has no bash. The CM5 entry point (`tests/smoke.sh`) delegates
// here instead of keeping a second copy of the rules.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { resolveShellHost } from '../src/platform/index.js'

const RUNTIME_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const INLINE_STYLE = /\sstyle=/
const ELEMENT_MARKUP = /widget|dash-|quota|w-clock|almanac|sb-net|sb-time|status-summary|tabler".*bolt/
const SHELL_CORE_SPECIFICS = /almanac|pomodoro|quota|dash-narrative|w-clock-time|w-chat|w-settings|sb-net|sb-time/

const REQUIRED_FILES = [
  'src/renderer/core/overlay-alerts.js',
  'src/renderer/core/registry.js',
  'src/renderer/core/services.js',
  'src/renderer/core/composer.js',
  'src/renderer/config/desktop_layout.js',
  'docs/AI_PLUGIN_GUIDE.md',
]

const SMOKE_TIMEOUT_MS = 30000

export function inspectIndexHtml(html) {
  const source = typeof html === 'string' ? html : ''
  if (INLINE_STYLE.test(source)) {
    return { ok: false, reason: 'index.html carries inline styles; placement belongs in config/desktop_layout.js' }
  }
  // Script tags are the one thing the skeleton may carry; element markup is
  // mounted by plugins, so it never belongs in the document.
  const withoutScripts = source.split('\n').filter((line) => !line.includes('<script')).join('\n')
  if (ELEMENT_MARKUP.test(withoutScripts)) {
    return { ok: false, reason: 'index.html contains element markup; everything visible is mounted from plugins' }
  }
  return { ok: true, reason: '' }
}

export function inspectShellCore(files) {
  const offenders = (files || []).filter((file) => SHELL_CORE_SPECIFICS.test(String(file?.source ?? '')))
  if (offenders.length > 0) {
    return {
      ok: false,
      reason: `shell core references element specifics in ${offenders.map((file) => file.path).join(', ')}; move them into plugins/`,
    }
  }
  return { ok: true, reason: '' }
}

/**
 * The stylesheet CLI is spawned as a script through the running Node, so no
 * host needs a `.bin` shim or a shell to find it.
 */
export function resolveUnocssCli({ root = RUNTIME_ROOT } = {}) {
  const manifestPath = path.join(root, 'node_modules', '@unocss', 'cli', 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.unocss
  if (!bin) throw new Error('@unocss/cli declares no unocss executable')
  return path.resolve(path.dirname(manifestPath), bin)
}

/**
 * How the acceptance script starts the Shell. The reference host keeps its
 * launcher, because `run.sh` is what supplies `.env.local`, the Wayland ozone
 * hint, and the sandbox flag a root kiosk session needs; bypassing it would
 * verify something the device never runs. A Windows host has no bash, so it
 * launches Electron directly.
 */
export function resolveSmokeCommand({ host = resolveShellHost() } = {}) {
  if (host.isWindows) return { command: require('electron'), args: ['.', '--smoke'] }
  return { command: 'bash', args: ['run.sh', '--smoke'] }
}

/**
 * The content size this host is configured for. The reference host's size is the
 * default; a device that cannot hold it states its own size through the same two
 * variables the main process reads, so the check can never disagree with the
 * window it is checking.
 */
export function configuredSize(env = process.env) {
  const width = Number.parseInt(env.ODESK_SHELL_WIDTH ?? '', 10) || 1920
  const height = Number.parseInt(env.ODESK_SHELL_HEIGHT ?? '', 10) || 1280
  return { width, height }
}

/**
 * The narrow-window scenario's size: deliberately smaller than what this host is
 * configured for, and never larger than the panel can show. The reference host
 * keeps its development size exactly; a device with a smaller panel gets a size
 * it can actually display, because a clamped window proves nothing about the
 * override.
 */
export function overrideSize(configured = configuredSize()) {
  return {
    width: Math.min(480, configured.width),
    height: Math.min(854, configured.height),
  }
}

function fail(message, logger = console) {
  logger.error(`FAIL: ${message}`)
  return 1
}

function buildStyles() {
  const cli = resolveUnocssCli()
  const result = spawnSync(process.execPath, [
    cli,
    'src/renderer/**/*.html',
    'src/renderer/**/*.js',
    '-c', 'uno.config.mjs',
    '-o', 'src/renderer/uno.css',
    '--minify',
  ], { cwd: RUNTIME_ROOT, encoding: 'utf8' })
  if (result.status !== 0) return fail(`stylesheet build failed: ${(result.stderr || '').trim() || 'no output'}`)
  return 0
}

function readSmokeResult(resultFile, stdout) {
  try {
    const line = readFileSync(resultFile, 'utf8').trim().split('\n').pop()
    if (line) return line
  } catch {
    // The result file is the reliable channel; stdout follows it in the shell run.
  }
  return String(stdout || '').trim().split('\n').filter((line) => line.startsWith('{')).pop() || ''
}

export function runSmoke({
  width,
  height,
  env = {},
  launcher = resolveSmokeCommand({}),
  spawn = spawnSync,
  logger = console,
} = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'odk-smoke-'))
  const resultFile = path.join(directory, 'result.json')
  const result = spawn(launcher.command, launcher.args, {
    cwd: RUNTIME_ROOT,
    encoding: 'utf8',
    timeout: SMOKE_TIMEOUT_MS,
    env: { ...process.env, ...env, ODESK_SMOKE_RESULT_FILE: resultFile },
  })
  const line = readSmokeResult(resultFile, result.stdout)
  console.log(`smoke: ${line || '(no result)'}`)
  if (!line) {
    return fail(`smoke process did not finish successfully${result.stderr ? `: ${result.stderr.trim().split('\n').pop()}` : ''}`, logger)
  }
  if (!line.includes('"ok":true')) return fail(`smoke reported not ok: ${line}`, logger)
  if (!line.includes(`"width":${width}`)) return fail(`expected width ${width}, got: ${line}`, logger)
  if (!line.includes(`"height":${height}`)) return fail(`expected height ${height}, got: ${line}`, logger)
  return 0
}

function collectShellCoreSources(root = RUNTIME_ROOT) {
  const files = []
  const shellJs = path.join(root, 'src/renderer/shell.js')
  if (existsSync(shellJs)) files.push({ path: 'src/renderer/shell.js', source: readFileSync(shellJs, 'utf8') })
  const core = path.join(root, 'src/renderer/core')
  if (existsSync(core)) {
    for (const entry of readdirSync(core, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue
      const absolute = path.join(entry.parentPath ?? core, entry.name)
      files.push({ path: path.relative(root, absolute), source: readFileSync(absolute, 'utf8') })
    }
  }
  return files
}

export function main() {
  console.log('== scenario: default size ==')
  const steps = [
    buildStyles,
    () => runSmoke(configuredSize()),
    () => {
      console.log('== scenario: no inline styles or element markup in index.html ==')
      const verdict = inspectIndexHtml(readFileSync(path.join(RUNTIME_ROOT, 'src/renderer/index.html'), 'utf8'))
      return verdict.ok ? 0 : fail(verdict.reason)
    },
    () => {
      console.log('== scenario: shell core stays plugin-free ==')
      const verdict = inspectShellCore(collectShellCoreSources())
      return verdict.ok ? 0 : fail(verdict.reason)
    },
    () => {
      const stylesheet = path.join(RUNTIME_ROOT, 'src/renderer/uno.css')
      return existsSync(stylesheet) && statSync(stylesheet).size > 0 ? 0 : fail('UnoCSS output is missing')
    },
    () => {
      const missing = REQUIRED_FILES.filter((file) => !existsSync(path.join(RUNTIME_ROOT, file)))
      return missing.length === 0 ? 0 : fail(`missing ${missing.join(', ')}`)
    },
    () => {
      console.log('== scenario: env override ==')
      const size = overrideSize()
      return runSmoke({
        width: size.width,
        height: size.height,
        env: { ODESK_SHELL_WIDTH: String(size.width), ODESK_SHELL_HEIGHT: String(size.height) },
      })
    },
    () => {
      const tokens = spawnSync(process.execPath, ['tests/check_tokens.mjs'], { cwd: RUNTIME_ROOT, stdio: 'inherit' })
      return tokens.status === 0 ? 0 : fail('token checks failed')
    },
    () => {
      const layout = spawnSync(process.execPath, ['tests/layout-harness.mjs'], { cwd: RUNTIME_ROOT, stdio: 'inherit' })
      return layout.status === 0 ? 0 : fail('layout checks failed')
    },
  ]

  for (const step of steps) {
    const code = step()
    if (code !== 0) return code
  }
  console.log('ALL SMOKE CHECKS PASSED')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}