import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { pathToFileURL } from 'node:url'
import { isAbsolute, normalize } from 'node:path'
import { createGmailClient, createGmailTools } from './index.mjs'

/** Only the operator environment supplies credentials. MCP arguments cannot select files. */
export function createGmailServer({ credentialsFile, fetchImpl = fetch }) {
  if (typeof credentialsFile !== 'string' || !isAbsolute(credentialsFile) || normalize(credentialsFile) !== credentialsFile || /[\x00-\x1f\x7f]/.test(credentialsFile)) throw Error('Gmail plugin requires a private absolute credentials path.')
  const client = createGmailClient({ credentialsFile, fetchImpl })
  const definitions = createGmailTools(client)
  const validator = new AjvJsonSchemaValidator()
  const schemas = new Map(definitions.map(tool => [tool.name, validator.getValidator(tool.inputSchema)]))
  const server = new Server({ name: 'odk-gmail', version: '0.1.1' }, { capabilities: { tools: {} } })
  server.onerror = () => {}
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: definitions.map(({ execute: _execute, ...definition }) => definition) }))
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const selected = definitions.find(tool => tool.name === request.params.name)
    const params = request.params.arguments ?? {}
    if (!selected || !schemas.get(selected.name)(params).valid) return { isError: true, content: [{ type: 'text', text: 'Gmail tool or arguments are unavailable.' }] }
    return selected.execute('mcp', params, extra.signal)
  })
  server.onclose = () => client.close()
  return { server, async close() { client.close(); await server.close() } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077)
  try {
    const runtime = createGmailServer({ credentialsFile: process.env.ODK_MCP_GMAIL_CREDENTIALS_FILE })
    await runtime.server.connect(new StdioServerTransport())
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void runtime.close().then(() => process.exit(0), () => process.exit(1)) })
  } catch { process.stderr.write('Gmail plugin failed. Check its private host configuration.\n'); process.exitCode = 1 }
}
