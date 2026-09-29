const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RUNTIME = path.resolve(__dirname, '..')
const REPO = path.resolve(RUNTIME, '..', '..')

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8')

test('the Windows Shell Host has executable scenarios', () => {
  const feature = read(RUNTIME, 'tests/features/windows-shell-host.feature')

  assert.match(feature, /Feature: 64-bit Windows as a Shell Host/)
  assert.match(feature, /no bash interpreter is required/)
  assert.match(feature, /pwsh -Command pi/)
  assert.match(feature, /its work directory is reported as unknown/)
  assert.match(feature, /process inspection uses the managed fallback/)
  // The Remote Link is the surface that is still not ported, and the voice link
  // is the one that is: the two must not be able to read as one sentence.
  assert.match(feature, /the Remote Link surface/)
  assert.match(feature, /Then it reports unavailable/)
  assert.match(feature, /the voice-agent named pipe/)
  assert.match(feature, /still reports voice as unavailable/)
})

test('the Windows runbook states which surfaces are ported and which are not', () => {
  const runbook = read(RUNTIME, 'docs/WINDOWS_HOST.md')

  for (const surface of ['Remote Bridge', '语音 Agent']) {
    assert.ok(runbook.includes(surface), `WINDOWS_HOST.md must name ${surface}`)
  }
  // Each surface is named as ported or unported, not merely as degraded: a reader
  // must be able to tell a missing capability from a broken one.
  assert.match(runbook, /未移植/)
  // The voice link is ported, and the runbook says what carries it and what
  // authenticates it, so a missing voice service cannot read as a missing voice
  // capability.
  assert.match(runbook, /open-deskos-voice-agent/)
  assert.match(runbook, /DirectShow/)

  // The surfaces this host does provide are stated with their transport and the
  // thing that authenticates it, so 'not ported' and 'ported to a named pipe'
  // cannot be confused for one another.
  assert.match(runbook, /open-deskos-desk-link/)
  assert.match(runbook, /open-deskos-user-app-control/)
  assert.match(runbook, /local-channel\.token/)
  assert.match(runbook, /0025-a-runtime-channel-is-authenticated-by-ownership-or-a-token/)

  assert.match(runbook, /工作目录可能未知/)
  assert.match(runbook, /pnpm run build:native/)
})

test('the Windows entry points do not require bash', () => {
  const launcher = read(RUNTIME, 'run.ps1')
  assert.match(launcher, /ODESK_SHELL_KIOSK/)
  assert.match(launcher, /\.env\.local/)

  // One set of acceptance rules: the CM5 wrapper delegates to the Node script
  // rather than repeating the checks it performs.
  const wrapper = read(RUNTIME, 'tests/smoke.sh')
  assert.match(wrapper, /node tests\/smoke\.mjs/)
  assert.doesNotMatch(wrapper, /check_tokens\.mjs/)

  const smoke = read(RUNTIME, 'tests/smoke.mjs')
  assert.match(smoke, /check_tokens\.mjs/)
  assert.match(smoke, /layout-harness\.mjs/)
})

test('the supported-host decision is recorded where a reader looks for it', () => {
  const adr = read(RUNTIME, 'docs/adr/0023-windows-x64-is-a-supported-shell-host.md')
  assert.match(adr, /64-bit Windows is a supported host/)
  assert.match(adr, /Windows on ARM is not/)

  const context = read(RUNTIME, 'CONTEXT.md')
  assert.match(context, /\*\*Shell Host\*\*/)
  assert.match(context, /\*\*Session Work Directory\*\*/)

  const spec = read(REPO, 'docs/wayfinding/windows-x64-shell-host/SPEC-WINDOWS-SHELL-HOST.md')
  assert.match(spec, /ADR-0023/)
})