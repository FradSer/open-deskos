import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const fixtureToken = 'a'.repeat(64)
export function endpoint(root, name) {
  return process.platform === 'win32' ? '\\\\.\\pipe\\odk-bot-test-' + createHash('sha256').update(root).digest('hex').slice(0, 24) + '-' + name : join(root, name)
}
export async function tokenEnvironment(t, root) {
  if (process.platform !== 'win32') return
  const previous = process.env.ODK_CHANNEL_TOKEN_FILE
  const file = join(root, 'channel.token')
  await writeFile(file, fixtureToken, { mode: 0o600 })
  process.env.ODK_CHANNEL_TOKEN_FILE = file
  t.after(() => { if (previous === undefined) delete process.env.ODK_CHANNEL_TOKEN_FILE; else process.env.ODK_CHANNEL_TOKEN_FILE = previous })
}
export function requests(client, callback) {
  let pending = '', authenticated = process.platform !== 'win32'
  client.on('data', chunk => {
    pending += chunk
    let newline
    while ((newline = pending.indexOf('\n')) >= 0) {
      const record = JSON.parse(pending.slice(0, newline)); pending = pending.slice(newline + 1)
      if (!authenticated) { assert.deepEqual(record, { v: 1, token: fixtureToken }); authenticated = true }
      else callback(record)
    }
  })
}
