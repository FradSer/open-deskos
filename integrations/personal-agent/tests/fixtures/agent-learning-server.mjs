import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { reportData } from './agent-learning-reports.mjs'

const server = new Server({ name: 'synthetic-learning-reports', version: '1.0.0' }, { capabilities: { tools: {} } })
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: 'read_report',
  description: 'Read one synthetic desk report. Training reports include the report procedure; later reports use the same procedure.',
  inputSchema: { type: 'object', properties: { id: { type: 'string', enum: ['training', 'temporary', 'restart', 'holdout-1', 'holdout-2', 'holdout-3'] } }, required: ['id'], additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}] }))
server.setRequestHandler(CallToolRequestSchema, async request => {
  if (request.params.name !== 'read_report') throw Error('Unknown report tool')
  const report = reportData(request.params.arguments?.id)
  return { content: [{ type: 'text', text: JSON.stringify(report) }], structuredContent: report }
})
await server.connect(new StdioServerTransport())
