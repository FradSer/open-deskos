import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Offline SDK fixtures must not read the developer's settings or resolve a
// package from them. Node's test runner isolates each test file's environment.
export async function isolateAgentDirectory(t, root, settings = {}) {
  const agentDir = join(root, 'agent')
  await mkdir(agentDir, { recursive: true })
  await writeFile(join(agentDir, 'settings.json'), JSON.stringify({
    compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off', ...settings,
  }))
  const original = process.env.PI_CODING_AGENT_DIR
  process.env.PI_CODING_AGENT_DIR = agentDir
  t.after(() => {
    if (original === undefined) delete process.env.PI_CODING_AGENT_DIR
    else process.env.PI_CODING_AGENT_DIR = original
  })
  return agentDir
}

export async function operatorSettingsBytes(agentDir) {
  return readFile(join(agentDir, 'settings.json'), 'utf8')
}
