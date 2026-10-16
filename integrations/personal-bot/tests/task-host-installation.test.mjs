import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const root = new URL('../', import.meta.url)

test('Linux task service runs independently with private data and immutable releases', async () => {
  const unit = await readFile(new URL('systemd/odk-pi-tasks.service', root), 'utf8')
  assert.match(unit, /ExecStart=__ODK_NODE_BIN__\/node __ODK_PERSONAL_BOT_DIR__\/src\/task-daemon\.mjs/)
  assert.match(unit, /ODK_TASK_CONFIG=%h\/\.config\/odk\/pi-tasks\.json/)
  assert.match(unit, /UMask=0077/)
  assert.match(unit, /ReadOnlyPaths=\/opt\/odk/)
  assert.doesNotMatch(unit, /Requires=.*voice|PartOf=.*voice/)
})

test('Mac task launch agent uses explicit executables and configuration', async () => {
  const plist = await readFile(new URL('launchd/com.odk.pi-tasks.plist', root), 'utf8')
  assert.match(plist, /<string>__ODK_NODE_BIN__\/node<\/string>/)
  assert.match(plist, /<string>__ODK_PERSONAL_BOT_DIR__\/src\/task-daemon\.mjs<\/string>/)
  assert.match(plist, /<key>ODK_TASK_CONFIG<\/key>/)
  assert.match(plist, /__ODK_HOME__\/\.config\/odk\/pi-tasks\.json/)
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/)
  assert.doesNotMatch(plist, /\/bin\/sh|ssh /)
})
