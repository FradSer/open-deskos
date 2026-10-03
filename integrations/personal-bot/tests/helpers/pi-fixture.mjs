import { createAgentSession, SettingsManager } from '@earendil-works/pi-coding-agent'

export const fixtureModel = { api: 'openai-responses', provider: 'offline-fixture', id: 'fixture', name: 'Offline fixture',
  baseUrl: 'https://example.invalid', reasoning: false, input: ['text'], contextWindow: 1000000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }

export function assistant(content, stopReason = 'stop') {
  return { role: 'assistant', api: fixtureModel.api, provider: fixtureModel.provider, model: fixtureModel.id,
    content: typeof content === 'string' ? [{ type: 'text', text: content }] : content, stopReason, timestamp: Date.now(),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
}

export function visibleTools(context) {
  const tools = new Map()
  for (const message of context.messages) {
    if (message.role !== 'system') continue
    if (message.replace) tools.clear()
    for (const name of message.toolsRemoved ?? []) tools.delete(typeof name === 'string' ? name : name.name)
    for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool)
  }
  return [...tools.values()]
}

// No SDK credentials, catalogs or network are read. The actual SDK agent loop,
// tool pipeline, QuickJS and session persistence run against these model events.
export async function offlineSession(options, reply, settings = {}) {
  const requests = []
  const runtime = {
    getAvailable: async () => [fixtureModel], getAvailableSnapshot: () => [fixtureModel],
    getModel: () => fixtureModel, getModels: () => [fixtureModel], getError: () => undefined,
    hasConfiguredAuth: () => true, isUsingOAuth: () => false, checkAuth: async () => ({}),
    getAuth: async () => ({ auth: { apiKey: 'offline-fixture' }, env: {} }),
    streamSimple: (_model, context) => {
      requests.push(context)
      const result = Promise.resolve(reply(context, requests.length))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    },
  }
  const { session } = await createAgentSession({ ...options, modelRuntime: runtime, model: fixtureModel,
    settingsManager: options.settingsManager ?? SettingsManager.inMemory({
      compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off', ...settings,
    }) })
  await session.bindExtensions({})
  return { session, requests, runtime }
}
