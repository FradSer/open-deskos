#!/usr/bin/env node
/** Edit the owner's Overview preference file. Run on the host that runs the resident agent. */
import { parseArgs } from 'node:util'
import { loadOverviewPreferences, writeOverviewPreferences } from '../src/overview-preferences.mjs'

const { values } = parseArgs({ options: {
  'must-show': { type: 'string', multiple: true },
  'private-source': { type: 'string', multiple: true },
  show: { type: 'boolean' },
} })

if (values.show) {
  console.log(JSON.stringify(await loadOverviewPreferences(), null, 2))
} else if (!values['must-show'] && !values['private-source']) {
  console.error('Pass --must-show <source id>, --private-source <source id>, or --show')
  process.exitCode = 2
} else {
  const current = await loadOverviewPreferences()
  const result = await writeOverviewPreferences({
    version: 1,
    mustShow: values['must-show'] ?? [...current.mustShow],
    privateSources: values['private-source'] ?? [...current.privateSources],
  })
  console.log(JSON.stringify({ path: result.path, preferences: result.preferences }, null, 2))
}
