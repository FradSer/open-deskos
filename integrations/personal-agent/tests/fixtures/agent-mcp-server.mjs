import { appendFileSync } from 'node:fs'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const record = value => { if (process.env.FIXTURE_EVENTS) appendFileSync(process.env.FIXTURE_EVENTS, `${value}\n`) }
record(`pid:${process.pid}`)
const server = new Server({ name: 'offline-agent-fixture', version: '1.0.0' }, { capabilities: { tools: { listChanged: true } } })
const definition = name => ({ name, description: `Fixture ${name}`, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } })
let dynamic = false
server.setRequestHandler(ListToolsRequestSchema, async request => {
  if (process.argv.includes('--pages')) return request.params?.cursor ? { tools: [definition('echo')] }
    : { tools: [{ ...definition('validated'), outputSchema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'], additionalProperties: false } }], nextCursor: 'last' }
  return { tools: ['echo', 'wait', 'fail', 'large', ...(dynamic ? ['newtool'] : [])].map(definition) }
})
let calls = 0
server.setRequestHandler(CallToolRequestSchema, async request => {
  calls++
  record(`called:${request.params.name}`)
  if (request.params.arguments.text === 'reveal-tool') { dynamic = true; await server.sendToolListChanged() }
  if (request.params.name === 'wait') return new Promise(() => {})
  if (request.params.name === 'fail') return { isError: true, content: [{ type: 'text', text: 'Fixture server refused the operation.' }] }
  if (request.params.name === 'large') return { content: [{ type: 'text', text: 'x'.repeat(80000) }] }
  if (request.params.name === 'validated') return { content: [{ type: 'text', text: 'Invalid fixture structured result.' }], structuredContent: { count: 'not a number' } }
  return { content: [{ type: 'text', text: request.params.arguments.text }], structuredContent: {
    calls, connectorCredential: process.env.FIXTURE_SECRET ?? null, inheritedProviderCredential: process.env.ANTHROPIC_API_KEY ?? null,
  } }
})
await server.connect(new StdioServerTransport())
