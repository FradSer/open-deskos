'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { runCommand } = require('./helpers/hydra-wire-lifecycle')
for (const mode of ['programmatic', 'development']) for (const invalid of [false, true]) test(`${mode} Pi Widget replacement ${invalid ? 'rejects changed counts' : 'preserves actual readings and recovery'}`, { timeout: 45000 }, async t => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-pi-tile-'))
  const env = { ...process.env, ODK_PI_TILE_PROFILE: profile, ODK_PI_TILE_INVALID: invalid ? '1' : '', ODK_PI_TILE_MODE: mode,
    OPEN_DESKOS_CONFIG_DIR: path.join(profile, 'config'), XDG_STATE_HOME: path.join(profile, 'state'), LOCALAPPDATA: path.join(profile, 'state') }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    if (mode === 'development') {
      const directory = path.join(profile, 'linked-widget')
      await fs.cp(path.join(__dirname, 'fixtures/pi-tile-surface-replacement'), directory, { recursive: true })
      const entry = path.join(directory, 'entry.js')
      let source = await fs.readFile(entry, 'utf8')
      source = source.replace('    mount(el, ctx) {', '    mount(el, ctx) { window.piTileEntryMounts=(window.piTileEntryMounts||0)+1;')
      if (invalid) source = source.replace("count.textContent = String(running)", "count.textContent = 'wrong'")
      await fs.writeFile(entry, 'window.piTileEntryExecutions=(window.piTileEntryExecutions||0)+1;\n' + source)
      await runCommand(process.execPath, [path.join(__dirname, '../scripts/open-deskos-plugin-cli.js'), 'link', directory, '--trust', '--replace'], { env, signal: t.signal, timeout: 10000 })
    }
    const running = runCommand(require('electron'), [`--user-data-dir=${profile}`, path.join(__dirname, 'pi-tile-surface-electron.cjs')], { env, signal: t.signal, timeout: 35000, maxBuffer: 1024 * 1024 })
    if (invalid) await assert.rejects(running, error => /Pi Widget did not settle/.test(error.stderr || ''))
    else assert.deepEqual(JSON.parse((await running).stdout.trim().split('\n').pop()), {
      actualPreload: true, mode, externalEntry: mode === 'development', discoveryReleased: true, themes: 3, sizes: 2, states: 7, comparisons: 84, retainedPlacement: true, subscriptionsReleased: true,
    })
  } finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) }
})
