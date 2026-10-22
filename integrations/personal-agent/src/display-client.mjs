import { mkdir, lstat, realpath } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadShellModule } from './plugin-composition.mjs'
import { createWindowsPrivatePaths } from './proactive-private-windows.mjs'
import { channelTokenFile } from './channel-token.mjs'
import { createDisplayRelay } from './display-relay.mjs'
import { createDisplayVoice } from './display-voice.mjs'
import { record } from './recorder.mjs'
const { resolveShellHost } = loadShellModule('platform/index.js', import.meta.url)

export async function startDisplayClient(env = process.env, platform = process.platform) {
  if (platform !== 'win32' || !env.LOCALAPPDATA || env.ODK_PERSONAL_AGENT_MAIN_SSH !== 'odk-cm5-agent') throw Error('Windows CM5 display configuration required')
  const directory = join(env.LOCALAPPDATA, 'odk', 'display-captures')
  return createDisplayRelay({ endpoint: resolveShellHost({ env, platform }).endpoint('personal-agent'),
    stateDir: dirname(channelTokenFile(env, platform)), alias: env.ODK_PERSONAL_AGENT_MAIN_SSH, platform,
    createVoice: ({ send }) => createDisplayVoice({ send,
      record: async onLevel => {
        if (!env.ODK_PERSONAL_AGENT_AUDIO_DEVICE || env.ODK_PERSONAL_AGENT_AUDIO_DEVICE === 'default') throw Error('Microphone device required')
        const privatePaths = createWindowsPrivatePaths()
        let created = false
        try { await mkdir(directory); created = true } catch (error) { if (error.code !== 'EEXIST') throw error }
        const info = await lstat(directory)
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw Error('Unsafe capture directory')
        privatePaths(created ? 'Protect' : 'Check', directory, true)
        return record(directory, env.ODK_PERSONAL_AGENT_AUDIO_DEVICE, onLevel, { platform })
      },
    }),
  })
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077)
  try {
    const client = await startDisplayClient()
    let stopping = false
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
      if (stopping) return
      stopping = true
      void client.close().then(() => { process.exitCode = 0 }, () => { process.exitCode = 1 })
    })
  } catch { console.error('Personal Agent display startup failed. Check the CM5 link and microphone configuration.'); process.exitCode = 1 }
}
