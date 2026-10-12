'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { installBuiltinViews, builtinViewTimeouts } = require('./helpers/builtin-view-selection')
const { runCommand, fixtureRejection } = require('./helpers/hydra-wire-lifecycle')

for (const mode of ['programmatic', 'development', 'native']) for (const fault of ['none', 'clock', 'focus']) test(`${mode} built-in view replacement ${fault === 'clock' ? 'rejects changed time behavior' : fault === 'focus' ? 'rejects missing keyboard focus' : 'preserves public App behavior'}`, { timeout: builtinViewTimeouts(mode).test }, async t => {
  const invalid = fault === 'clock'
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-builtin-views-'))
  const env = { ...process.env, ODK_BUILTIN_VIEWS_PROFILE: profile, ODK_BUILTIN_VIEWS_MODE: mode, ODK_BUILTIN_VIEWS_INVALID: invalid ? '1' : '', ODK_BUILTIN_VIEWS_FOCUS_INVALID: fault === 'focus' ? '1' : '',
    OPEN_DESKOS_CONFIG_DIR: path.join(profile, 'config'), XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    if (mode !== 'programmatic') await installBuiltinViews(profile, env, { mode, invalid, signal: t.signal })
    const renderingArgs = process.platform === 'linux' ? ['--disable-gpu'] : []
    const running = runCommand(require('electron'), [...renderingArgs, `--user-data-dir=${profile}`, path.join(__dirname, 'builtin-view-replacement.cjs')],
      { env, signal: t.signal, timeout: builtinViewTimeouts(mode).child, maxBuffer: 1024 * 1024 })
    if (fault !== 'none') await assert.rejects(running, error => fixtureRejection(error, invalid ? /independent clock reading changed/ : /Keyboard focus marker absent/))
    else {
      const phases = mode === 'native' ? 5 : 3
      const result = await running
      if (env.ODK_BUILTIN_VIEWS_TRACE === '1') process.stderr.write(result.stderr)
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
        views: 5, phases, focusChecks: phases * 21, externalEntries: mode === 'native' ? 15 : mode === 'development' ? 5 : 0,
        ...(mode === 'native' ? { protocolReleased: true, revisions: ['2.0.0', '3.0.0', '2.0.0'] } : {}),
        discoveryReleased: true, actualPreload: true, documentLoads: 1, pointerBack: phases * 9, lateReplies: phases * 2,
        keyboard: { loops: phases * 5, searches: phases, reloads: phases, back: phases * 5 },
        subscriptionsReleased: true, tickTimerReleased: true,
      })
    }
  } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
