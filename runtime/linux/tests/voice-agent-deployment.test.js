const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const installer = fs.readFileSync('scripts/cm5-install.sh', 'utf8')
const stage = fs.readFileSync('scripts/cm5-stage-release.sh', 'utf8')
const helperPath = path.resolve('scripts/cm5-voice-agent.sh')

test('integration staging excludes host dependencies and private auth/config', () => {
  const integrations = stage.split('\n').filter((line, index, lines) =>
    line.includes('"${ROOT}/integrations/"') || lines[index + 1]?.includes('"${ROOT}/integrations/"')).join('\n')
  for (const excluded of ['node_modules', '.env*', 'auth.json', '.pi', '*.env']) {
    assert.ok(integrations.includes(`--exclude '${excluded}'`), excluded)
  }
})

test('voice is packaged before activation and independently started afterward', () => {
  assert.match(installer, /source "\$\{DIR\}\/scripts\/cm5-voice-agent.sh"/)
  assert.ok(installer.indexOf('prepare_voice_agent_release') < installer.indexOf('scripts/update-runtime.js'))
  assert.ok(installer.indexOf('install_voice_agent_service') > installer.indexOf('scripts/migrate-runtime.js'))
  assert.match(installer, /install_voice_agent_service \|\|/)
  assert.doesNotMatch(installer, /(?:Requires|Wants)=open-deskos-voice/)
})

test('voice activation failure returns control without stopping the base shell', () => {
  const result = spawnSync('bash', ['-c', `
    set -euo pipefail
    source "$1"
    RUNTIME_ROOT=/not-used TARGET_HOME=/not-used SUDO=false
    install_voice_agent_service || printf 'voice-unavailable\\n'
    printf 'shell-continues\\n'
  `, 'test', helperPath], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, 'voice-unavailable\nshell-continues\n')
})

test('voice preparation rejects unsupported Node before creating candidate files', () => {
  const result = spawnSync('bash', ['-c', `
    set -euo pipefail
    source "$1"
    NODE_BIN=/selected RELEASE_DIR=/unused
    run_as_target_user() { printf 'v22.14.0\\n'; }
    prepare_voice_agent_release
  `, 'test', helperPath], { encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /Node >=22\.19\.0/)
})

test('voice packaging installs frozen production dependencies in release only', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-voice-deploy-'))
  try {
    fs.mkdirSync(path.join(dir, 'source'))
    fs.mkdirSync(path.join(dir, 'release'))
    fs.writeFileSync(path.join(dir, 'source', 'package.json'), '{}')
    fs.writeFileSync(path.join(dir, 'source', 'pnpm-lock.yaml'), '')
    fs.mkdirSync(path.join(dir, 'source', 'src'))
    fs.mkdirSync(path.join(dir, 'source', 'systemd'))
    fs.writeFileSync(path.join(dir, 'source', 'auth.json'), 'private')
    const packaged = spawnSync('bash', ['-c', `
      set -euo pipefail
      source "$1"
      VOICE_AGENT_SOURCE="$2/source"
      RELEASE_DIR="$2/release"
      NODE_BIN="${path.dirname(process.execPath)}"
      LOG="$2/log"
      run_as_target_user() { if [ "$1" = pnpm ]; then printf '%s\\n' "$PWD:$*" >> "$LOG"; else "$@"; fi; }
      prepare_voice_agent_release
    `, 'test', helperPath, dir], { encoding: 'utf8' })
    assert.equal(packaged.status, 0, packaged.stderr)
    assert.ok(fs.existsSync(path.join(dir, 'release/integrations/voice-agent/package.json')))
    assert.equal(fs.existsSync(path.join(dir, 'release/integrations/voice-agent/auth.json')), false)
    assert.equal(fs.readFileSync(path.join(dir, 'log'), 'utf8').trim(), `${dir}/release/integrations/voice-agent:pnpm install --prod --frozen-lockfile --ignore-scripts`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
