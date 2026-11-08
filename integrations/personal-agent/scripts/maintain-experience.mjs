import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createExperienceStore, experienceRevision } from '../src/agent-plugins/experience.mjs'
import { createMem0Backend } from '../src/mem0.mjs'
import { isLocalAbsolutePath } from '../src/personal-config.mjs'

const usage = 'Usage: pnpm agent:experience --state-dir=ABSOLUTE_PATH list | show ID | withdraw ID REVISION | replace ID REVISION REPLACEMENT_ID | restore ID REVISION'
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'state-dir': { type: 'string' }, help: { type: 'boolean' },
} })
if (values.help) {
  console.log(usage)
} else {
  if (!isLocalAbsolutePath(values['state-dir'])) throw Error(usage)
  const stateDir = values['state-dir']
  const backend = createMem0Backend({ stateDir })
  const store = createExperienceStore({ scope: backend.scope(stateDir, 'experience'), stateDir,
    legacyFile: join(stateDir, 'personal-agent', 'experience.json') })
  try {
    const [action, id, expectedRevision, replacementId] = positionals
    const withRevision = entry => ({ entry, expectedRevision: experienceRevision(entry) })
    let result
    if (action === 'list' && positionals.length === 1) {
      result = (await store.load()).entries.map(entry => ({
        id: entry.id, title: entry.title, scope: entry.scope, retired: entry.retired, expectedRevision: experienceRevision(entry),
      }))
    } else if (action === 'show' && positionals.length === 2) {
      const entry = (await store.load()).entries.find(entry => entry.id === id)
      if (!entry) throw Error('Experience is unavailable')
      result = withRevision(entry)
    } else {
      if (!(action === 'replace' ? positionals.length === 4
        : (action === 'withdraw' || action === 'restore') && positionals.length === 3)) throw Error(usage)
      result = withRevision(await store.maintain({ action, id, expectedRevision, replacementId }))
    }
    console.log(JSON.stringify(result, null, 2))
  } finally { await backend.close() }
}
