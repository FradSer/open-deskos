const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RUNTIME_ROOT = path.resolve(__dirname, '..')

const load = async () => import('../tests/smoke.mjs')

test('the acceptance checks reject a shell document that carries styles or element markup', async () => {
  const { inspectIndexHtml } = await load()

  const styled = inspectIndexHtml('<main id="desk" style="padding:0"></main>')
  assert.equal(styled.ok, false)
  assert.match(styled.reason, /inline styles/)

  const markup = inspectIndexHtml('<script src="shell.js"></script>\n<div class="quota-card"></div>')
  assert.equal(markup.ok, false)
  assert.match(markup.reason, /element markup/)

  const skeleton = inspectIndexHtml('<script src="shell.js"></script>\n<main id="desk"></main>\n<section id="pages"></section>')
  assert.equal(skeleton.ok, true)
  assert.equal(skeleton.reason, '')
})

test('the acceptance checks keep element specifics out of the shell core', async () => {
  const { inspectShellCore } = await load()

  const leaked = inspectShellCore([{ path: 'core/whatever.js', source: "const id = 'almanac'" }])
  assert.equal(leaked.ok, false)
  assert.match(leaked.reason, /shell core/)

  const clean = inspectShellCore([{ path: 'core/registry.js', source: 'export const registry = new Map()' }])
  assert.equal(clean.ok, true)
})

test('the acceptance script launches through the host launcher, not around it', async () => {
  const { resolveSmokeCommand } = await load()

  // The reference host keeps its launcher, so a root kiosk session keeps the
  // sandbox flag and a Wayland session keeps its ozone hint.
  const unix = resolveSmokeCommand({ host: { isWindows: false } })
  assert.equal(unix.command, 'bash')
  assert.deepEqual(unix.args, ['run.sh', '--smoke'])

  // A Windows host has no bash, so it launches Electron directly.
  const windows = resolveSmokeCommand({ host: { isWindows: true } })
  assert.ok(path.isAbsolute(windows.command), 'a Windows launch needs an absolute executable path')
  assert.deepEqual(windows.args, ['.', '--smoke'])
})

test('the acceptance script decides from the reported result, not from the exit code', async () => {
  const { runSmoke } = await load()
  const messages = []
  const logger = { error: (message) => messages.push(message) }
  const launcher = { command: 'bash', args: ['run.sh', '--smoke'] }

  const run = (payload, { status = 0, reported = true, size = { width: 1920, height: 1280 } } = {}) => {
    const seen = []
    const spawn = (command, args, options) => {
      seen.push({ command, args })
      if (reported) fs.writeFileSync(options.env.ODESK_SMOKE_RESULT_FILE, `${JSON.stringify(payload)}\n`, 'utf8')
      return { status, stdout: '' }
    }
    const code = runSmoke({ ...size, launcher, spawn, logger })
    return { code, seen }
  }

  const ok = run({ ok: true, width: 1920, height: 1280 })
  assert.equal(ok.code, 0)
  assert.deepEqual(ok.seen, [{ command: 'bash', args: ['run.sh', '--smoke'] }], 'the host launcher is the one used')

  assert.equal(run({ ok: false, reason: 'timeout' }).code, 1)
  assert.match(messages.pop(), /not ok/)

  assert.equal(run({ ok: true, width: 1280, height: 800 }).code, 1)
  assert.match(messages.pop(), /expected width 1920/)

  assert.equal(run({ ok: true, width: 1920, height: 800 }).code, 1)
  assert.match(messages.pop(), /expected height 1280/)

  assert.equal(run({}, { reported: false, status: 1 }).code, 1)
  assert.match(messages.pop(), /did not finish/)
})

test('the acceptance script checks the size this host is configured for', async () => {
  const { configuredSize } = await load()

  // The reference host's content size is the default, and a device that cannot
  // hold it states its own size instead — the same variable the main process
  // reads, so the check cannot disagree with the window that runs.
  assert.deepEqual(configuredSize({}), { width: 1920, height: 1280 })
  assert.deepEqual(configuredSize({ ODESK_SHELL_WIDTH: '1280', ODESK_SHELL_HEIGHT: '800' }), { width: 1280, height: 800 })
  assert.deepEqual(configuredSize({ ODESK_SHELL_WIDTH: 'nonsense', ODESK_SHELL_HEIGHT: '' }), { width: 1920, height: 1280 })
})

test('the override scenario asks for a size this host can actually show', async () => {
  const { overrideSize } = await load()

  // The reference host's development size is what the override proves; a device
  // with a smaller panel cannot show it, and a window the window manager clamped
  // is not a failed override.
  assert.deepEqual(overrideSize({ width: 1920, height: 1280 }), { width: 480, height: 854 })
  assert.deepEqual(overrideSize({ width: 1280, height: 776 }), { width: 480, height: 776 })
})

test('the acceptance script resolves the stylesheet CLI the release installs', async () => {
  const { resolveUnocssCli } = await load()

  const cli = resolveUnocssCli({ root: RUNTIME_ROOT })
  assert.ok(path.isAbsolute(cli), 'an absolute path is required to spawn it without a shell')
  assert.ok(fs.existsSync(cli), `${cli} must exist`)
})