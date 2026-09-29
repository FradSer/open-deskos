const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const scripts = path.join(__dirname, '..', 'scripts')
const launcher = fs.readFileSync(path.join(scripts, 'windows-voice.ps1'), 'utf8')
const provisioner = fs.readFileSync(path.join(scripts, 'provision-voice.ps1'), 'utf8')
const acceptance = fs.readFileSync(path.join(scripts, 'voice-acceptance.mjs'), 'utf8')

// PowerShell 5.1 reads a BOM-less .ps1 in the system code page, so a Chinese
// comment is a syntax error on a GBK host rather than a display glitch. This is
// the one place where a byte-level fact is the contract.
test('the Windows voice scripts stay ASCII so a code-page host can parse them', () => {
  for (const [name, source] of [['windows-voice.ps1', launcher], ['provision-voice.ps1', provisioner]]) {
    const offending = [...source].filter(character => character.codePointAt(0) > 127)
    assert.deepEqual(offending, [], `${name} carries non-ASCII characters: ${offending.slice(0, 5).join('')}`)
  }
})

test('the voice launcher supervises the same entry point the CM5 unit runs', () => {
  assert.match(launcher, /src\\main\.mjs/)
  // The voice package is beside the flattened runtime root in a release and at the
  // repository root in a checkout, two levels up from runtime/linux, so both
  // locations are probed rather than one layout being assumed and reported as a
  // missing entry point.
  assert.match(launcher, /integrations\\voice-agent/)
  assert.match(launcher, /Join-Path \$RuntimeRoot 'integrations\\voice-agent'/)
  assert.match(launcher, /Join-Path \(Join-Path \(Join-Path \$RuntimeRoot '\.\.'\) '\.\.'\) 'integrations\\voice-agent'/)
  assert.match(launcher, /Test-Path -LiteralPath \(Join-Path \$candidate 'src\\main\.mjs'\)/)
  // The same two device-local environment files the Unix unit reads, in the same
  // KEY=VALUE format the Shell's .env.local uses.
  assert.match(launcher, /Join-Path \$configDir 'runtime\.env'/)
  assert.match(launcher, /Join-Path \$configDir 'voice-agent\.env'/)
  assert.match(launcher, /while \(\$true\)/, 'the restart loop is the unit\'s Restart=on-failure')
  assert.match(launcher, /Start-Sleep -Seconds \$RestartDelaySeconds/)
  assert.match(launcher, /voice\.log/)
  // A task cannot register another task, so the launcher must never try to.
  assert.doesNotMatch(launcher, /Register-ScheduledTask|schtasks/)
  assert.doesNotMatch(launcher, /Start-Process\s+powershell/)
})

test('the voice provisioner states what is missing and installs nothing by default', () => {
  assert.match(provisioner, /-LogonType Interactive/, 'a microphone needs the logged-on session, not session 0')
  assert.match(provisioner, /-AllowStartIfOnBatteries/)
  assert.match(provisioner, /-DontStopIfGoingOnBatteries/)
  assert.match(provisioner, /RestartCount/)
  assert.match(provisioner, /\[switch\]\$Report/)
  assert.match(provisioner, /\[switch\]\$InstallFfmpeg/)
  assert.match(provisioner, /Join-Path \$RuntimeRoot 'integrations\\voice-agent'/)
  assert.match(provisioner, /Join-Path \(Join-Path \(Join-Path \$RuntimeRoot '\.\.'\) '\.\.'\) 'integrations\\voice-agent'/)
  assert.match(provisioner, /ffmpeg is missing and was not installed/, 'the host is told rather than left guessing')
  assert.match(provisioner, /Register-ScheduledTask -TaskName \$TaskName/)
  assert.match(provisioner, /voice-agent\.env/)
  assert.match(provisioner, /local-channel\.token/, 'the channel token is the named pipe\'s gate and is stated')
  // -Report must reach its exit before anything is installed or registered.
  assert.ok(
    provisioner.indexOf('if ($Report) { exit 0 }') < provisioner.indexOf('Register-ScheduledTask -TaskName'),
    'a report must not register the task',
  )
})

test('acceptance speaks the published protocol and never prints a credential', () => {
  assert.match(acceptance, /host\.endpoint\('voice-agent'\)/, 'acceptance reaches the endpoint the host naming gives')
  assert.match(acceptance, /requiresToken/)
  assert.match(acceptance, /writeHandshake/)
  assert.match(acceptance, /JSON\.stringify\(\{ v: 1, type \}\)/, 'the acceptance tool speaks the published frame, not a private one')
  assert.match(acceptance, /send\(socket, 'toggle'\)/)
  assert.match(acceptance, /record\.transcript/)
  // The token is read and written to the socket; no report line carries its value,
  // neither interpolated into a message nor passed as an argument.
  assert.doesNotMatch(acceptance, /console\.(log|error)\(\s*`[^`]*\$\{[^}]*token/)
  assert.doesNotMatch(acceptance, /console\.(log|error)\([^)]*[, (]\s*token\s*[),]/)
})

// The Desk Link Service is what another machine's Pi sessions arrive on. It is a
// resident service like the voice one, and the same two hazards apply: a launcher
// that reads a log note as a crash, and a provisioner that installs something the
// operator did not ask for.
const deskLink = fs.readFileSync(path.join(scripts, 'windows-desk-link.ps1'), 'utf8')
const deskLinkProvisioner = fs.readFileSync(path.join(scripts, 'provision-desk-link.ps1'), 'utf8')

test('the desk link scripts stay ASCII so a code-page host can parse them', () => {
  for (const [name, source] of [['windows-desk-link.ps1', deskLink], ['provision-desk-link.ps1', deskLinkProvisioner]]) {
    const offending = [...source].filter(character => character.codePointAt(0) > 127)
    assert.deepEqual(offending, [], `${name} carries non-ASCII characters: ${offending.slice(0, 5).join('')}`)
  }
})

test('a service that writes a note to stderr is reporting, not failing', () => {
  // PowerShell turns native stderr into an error record, so with Stop an
  // informational line — an empty control credential, for instance — would take
  // the whole loop down and take the link with it.
  for (const [name, source] of [['windows-desk-link.ps1', deskLink], ['windows-voice.ps1', launcher]]) {
    assert.match(source, /\$ErrorActionPreference = 'Continue'/, `${name} must not treat a service note as a crash`)
    assert.match(source, /2>&1 \| ForEach-Object/, `${name} must relay the service's own output`)
  }
})

test('the desk link launcher supervises the same entry point and environment the desk reads', () => {
  assert.match(deskLink, /scripts\\desk-link-service\.js/)
  assert.match(deskLink, /\.env\.local/, 'the desk\'s own device configuration is the input')
  assert.match(deskLink, /while \(\$true\)/, 'the restart loop is the unit\'s Restart=on-failure')
  assert.doesNotMatch(deskLink, /Register-ScheduledTask|schtasks/, 'a task cannot register a task')
})

test('the desk link provisioner states what is missing and registers nothing by default', () => {
  assert.match(deskLinkProvisioner, /\[switch\]\$Report/)
  assert.match(deskLinkProvisioner, /\[switch\]\$Start/)
  assert.match(deskLinkProvisioner, /-LogonType Interactive/, 'a resident service runs in the logged-on session')
  assert.match(deskLinkProvisioner, /holding no value|holds no value/, 'an empty token file is stated, not skipped')
  assert.match(deskLinkProvisioner, /accepts reporting only/, 'an empty control credential is a truthful state the operator hears once')
  assert.match(deskLinkProvisioner, /Register-ScheduledTask -TaskName \$TaskName/)
  assert.ok(
    deskLinkProvisioner.indexOf('if ($Report) { exit 0 }') < deskLinkProvisioner.indexOf('Register-ScheduledTask -TaskName'),
    'a report must not register the task',
  )
})
