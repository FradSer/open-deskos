const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RUNTIME = path.resolve(__dirname, '..')
const REPO = path.resolve(RUNTIME, '..', '..')

// A release flattens the runtime to the release root, so there is no repository
// above it. A document that lives only in the repository is therefore absent from a
// release by design, and an assertion about one states that rather than failing on
// an artifact that was never meant to carry it.
const inReleaseLayout = fs.existsSync(path.join(RUNTIME, 'integrations'))
const repositoryOnly = inReleaseLayout
  ? { skip: 'a repository document is not part of a release, so this runs in a checkout only' }
  : {}

const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8')

const readDecision = (id) => {
  const architecture = read(RUNTIME, 'docs/ARCHITECTURE.md')
  const marker = `<a id="adr-${id}"></a>`
  const start = architecture.indexOf(marker)
  assert.notEqual(start, -1, `architecture must retain ADR-${id}`)
  const next = architecture.indexOf('<a id="adr-', start + marker.length)
  return architecture.slice(start, next === -1 ? undefined : next)
}

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
  assert.match(feature, /the personal-bot named pipe/)
  assert.match(feature, /still reports voice as unavailable/)
  // The panel is the desk's whole surface on this host: it covers the display
  // and the user cannot move it. Both halves are scenarios, not only code.
  assert.match(feature, /the panel geometry equals the display bounds/)
  assert.match(feature, /it is asked again while the window is short of the display/)
  assert.match(feature, /it is not movable, resizable, maximizable or minimizable/)
})

test('the Windows runbook states which surfaces are ported and which are not', () => {
  const runbook = read(RUNTIME, 'docs/WINDOWS_HOST.md')

  for (const surface of ['Remote Bridge', 'Voice Agent']) {
    assert.ok(runbook.includes(surface), `WINDOWS_HOST.md must name ${surface}`)
  }
  // Each surface is named as ported or unported, not merely as degraded: a reader
  // must be able to tell a missing capability from a broken one.
  assert.match(runbook, /Not ported/)
  // The voice link is ported, and the runbook says what carries it and what
  // authenticates it, so a missing personal bot service cannot read as a missing voice
  // capability.
  assert.match(runbook, /open-deskos-personal-bot/)
  assert.match(runbook, /DirectShow/)

  // The surfaces this host does provide are stated with their transport and the
  // thing that authenticates it, so 'not ported' and 'ported to a named pipe'
  // cannot be confused for one another.
  assert.match(runbook, /open-deskos-desk-link/)
  assert.match(runbook, /open-deskos-user-app-control/)
  assert.match(runbook, /local-channel\.token/)
  assert.match(runbook, /ADR-0025/)

  assert.match(runbook, /working directory can be unknown/)
  assert.match(runbook, /pnpm run build:native/)

  // The panel covers the display rather than the work area, and it is not a
  // window the user can drag; both are stated with the measurement that
  // established them, so a reader can tell a rule from a guess.
  assert.match(runbook, /panel covers the display, not the work area/)
  assert.match(runbook, /WS_THICKFRAME/)
  assert.match(runbook, /not topmost/)
})

test('the panel decision is recorded where a reader looks for it', () => {
  const adr = readDecision('0034')
  assert.match(adr, /fullscreen is geometry/)
  assert.match(adr, /not topmost/)
  assert.match(adr, /WS_THICKFRAME/)
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

test('the supported-host decision is recorded where a reader looks for it', repositoryOnly, () => {
  const adr = readDecision('0023')
  assert.match(adr, /64-bit Windows is a supported host/)
  assert.match(adr, /Windows on ARM is not/)

  const context = read(RUNTIME, 'CONTEXT.md')
  assert.match(context, /\*\*Shell Host\*\*/)
  assert.match(context, /\*\*Session Work Directory\*\*/)

  const spec = read(RUNTIME, 'docs/WINDOWS_HOST.md')
  assert.match(spec, /ADR-0023/)
})