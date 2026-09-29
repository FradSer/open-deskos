import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Where this host keeps what the service writes.
 *
 * A Unix host keeps captures in the runtime directory, because a recording must
 * not outlive the session that made it, and keeps agent state where XDG says.
 * A Windows host has no runtime directory, so both sit under the host's own local
 * application data, which is where its other device-local state already is.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @returns {{ captures: string, state: string }}
 */
export function hostDirectories(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const root = join(env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'open-deskos', 'voice')
    return { captures: root, state: root }
  }
  return {
    captures: join(env.XDG_RUNTIME_DIR, 'open-deskos-voice'),
    state: join(env.XDG_STATE_HOME || join(homedir(), '.local/state'), 'open-deskos-voice'),
  }
}

/**
 * Create the directories this service writes in.
 *
 * On a Unix host the control socket's own ownership preparation creates the
 * directory that holds it, which is why this never had to happen here. A named
 * pipe has no directory to prepare, so on a Windows host nothing else would
 * create it, and the service would exit before it could answer a single status
 * request. Creating it here is what makes the two hosts reach the same state.
 *
 * A directory this host cannot create is not a warning: the service would have
 * nowhere to keep a recording, so the failure is allowed to stop startup.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [platform]
 * @param {typeof mkdir} [create]
 */
export async function prepareHostDirectories(env = process.env, platform = process.platform, create = mkdir) {
  const directories = hostDirectories(env, platform)
  for (const directory of new Set(Object.values(directories))) {
    await create(directory, { recursive: true, mode: 0o700 })
  }
  return directories
}
