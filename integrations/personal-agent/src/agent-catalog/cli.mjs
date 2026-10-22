import { pathToFileURL } from 'node:url'
import { openAgentCatalog } from './catalog.mjs'
import { readLocalFile } from '../personal-config.mjs'

/** Operator entry point. It never loads the resident, credentials, models, or MCP processes. */
export async function runAgentCatalogCli(argv, { env = process.env, output = text => process.stdout.write(`${text}\n`) } = {}) {
  const args = [...argv]
  let directory = env.ODK_AGENT_CATALOG_DIR
  if (args[0] === '--directory') { args.shift(); directory = args.shift() }
  if (!directory) throw Error('Set an explicit private catalog directory with --directory or ODK_AGENT_CATALOG_DIR.')
  const command = args.shift()
  const catalog = await openAgentCatalog(directory)
  let result
  if (command === 'list' && args.length === 0) result = await catalog.list()
  else if (command === 'install-skill' && args.length === 1) result = await catalog.installSkill(args[0])
  else if (command === 'install-mcp' && args.length === 1) result = await catalog.installMcp(JSON.parse(readLocalFile(args[0], 32768)))
  else if (command === 'read-skill' && args.length >= 1 && args.length <= 2) {
    output(await catalog.readSkill(args[0], args[1]))
    return
  } else if (command === 'remove' && args.length === 1) result = await catalog.remove(args[0])
  else if (command === 'rollback' && args.length === 2) result = await catalog.rollback(args[0], args[1])
  else throw Error('Use list, install-skill <directory>, install-mcp <manifest>, read-skill <id> [resource], remove <id>, or rollback <id> <revision>.')
  output(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await runAgentCatalogCli(process.argv.slice(2)) } catch (error) {
    // Filesystem and parser errors can contain private paths or package bytes.
    const message = error.message?.startsWith('Set an explicit private catalog directory') || error.message?.startsWith('Use list,')
      ? error.message : 'Agent package command failed. Check private paths, package metadata, resource limits, and the selected revision.'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
}
