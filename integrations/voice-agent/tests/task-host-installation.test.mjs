import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

test('Linux task service runs independently with private data and immutable releases', async () => {
  const unit = await readFile(new URL('systemd/open-deskos-pi-tasks.service', root), 'utf8')
  assert.match(unit, /ExecStart=__OPEN_DESKOS_NODE_BIN__\/node __OPEN_DESKOS_VOICE_AGENT_DIR__\/src\/task-daemon\.mjs/)
  assert.match(unit, /ODESK_TASK_CONFIG=%h\/\.config\/open-deskos\/pi-tasks\.json/)
  assert.match(unit, /UMask=0077/)
  assert.match(unit, /ReadOnlyPaths=\/opt\/open-deskos/)
  assert.doesNotMatch(unit, /Requires=.*voice|PartOf=.*voice/)
})

test('Mac task launch agent uses explicit executables and configuration', async () => {
  const plist = await readFile(new URL('launchd/com.open-deskos.pi-tasks.plist', root), 'utf8')
  assert.match(plist, /<string>__OPEN_DESKOS_NODE_BIN__\/node<\/string>/)
  assert.match(plist, /<string>__OPEN_DESKOS_VOICE_AGENT_DIR__\/src\/task-daemon\.mjs<\/string>/)
  assert.match(plist, /<key>ODESK_TASK_CONFIG<\/key>/)
  assert.match(plist, /__OPEN_DESKOS_HOME__\/\.config\/open-deskos\/pi-tasks\.json/)
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/)
  assert.doesNotMatch(plist, /\/bin\/sh|ssh /)
})
