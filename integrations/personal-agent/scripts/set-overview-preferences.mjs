#!/usr/bin/env node
/** Edit the owner's Overview Markdown preference file. Run on the host that runs the resident agent. */
import { readFile, writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { compileOwnerMarkdown, ownerMarkdownPath, writeOwnerMarkdown } from '../src/overview-preferences.mjs'

const { values } = parseArgs({ options: {
  'always-show': { type: 'string', multiple: true },
  'never-disclose': { type: 'string', multiple: true },
  show: { type: 'boolean' },
} })

const path = ownerMarkdownPath()

if (values.show) {
  let body = ''
  try { body = await readFile(path, 'utf8') } catch { body = '' }
  const compiled = compileOwnerMarkdown(body)
  console.log(JSON.stringify({ path, mustShow: compiled.mustShow, privateSources: compiled.privateSources, unapplied: compiled.unapplied }, null, 2))
} else if (!values['always-show'] && !values['never-disclose']) {
  console.error('Pass --always-show <holdings|Pi sessions>, --never-disclose <term>, or --show')
  process.exitCode = 2
} else {
  const result = await writeOwnerMarkdown({
    alwaysShow: values['always-show'] ?? [],
    neverDisclose: values['never-disclose'] ?? [],
  }, { write: writeFile })
  console.log(JSON.stringify({ path: result.path, directives: result.directives }, null, 2))
}
