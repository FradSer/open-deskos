import { protectProactivePath, checkProactivePath } from './proactive-private.mjs'
import { lstat, rename, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Legacy names are accepted only at this migration boundary. New settings win. */
export function personalBotEnvironment(env = process.env) {
  const normalized = { ...env }
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith('ODESK_VOICE_')) continue
    const destination = name.replace('ODESK_VOICE_AGENT_', 'ODESK_PERSONAL_BOT_').replace('ODESK_VOICE_', 'ODESK_PERSONAL_BOT_')
    if (normalized[destination] === undefined) normalized[destination] = value
  }
  return normalized
}

/** Move private history once, preserving permissions and refusing ambiguous histories. */
export async function migratePersonalBotState(env = process.env, platform = process.platform) {
  const parent = platform === 'win32'
    ? join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'open-deskos')
    : env.XDG_STATE_HOME || join(homedir(), '.local/state')
  const legacy = join(parent, platform === 'win32' ? 'voice' : 'open-deskos-voice')
  const destination = join(parent, platform === 'win32' ? 'personal-bot' : 'open-deskos-personal-bot')
  const info = await lstat(legacy).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (!info) return
  if (!info.isDirectory() || (platform !== 'win32' && (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0))) throw Error('Unsafe legacy bot state directory')
  const target = await lstat(destination).catch(error => { if (error.code === 'ENOENT') return null; throw error })
  if (target) throw Error('Both legacy and Personal Bot state exist; resolve histories before startup')
  async function validateTree(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      const info = await lstat(file)
      if ((!info.isFile() && !info.isDirectory()) || (info.isFile() && info.nlink !== 1) || (platform !== 'win32' && info.uid !== process.getuid?.())) throw Error('Unsafe legacy bot state entry')
      if (info.isDirectory()) await validateTree(file)
    }
  }
  await validateTree(legacy)
  if (process.platform === 'win32') {
    // Legacy history may inherit broad Windows ACLs. Restrict each existing entry
    // before moving it; never follow a link outside this state tree.
    async function protectTree(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name)
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw Error('Unsafe legacy bot state entry')
        if (entry.isDirectory()) await protectTree(file)
        else protectProactivePath(file)
      }
      protectProactivePath(directory)
      checkProactivePath(directory)
    }
    await protectTree(legacy)
  }
  await rename(legacy, destination)
}
