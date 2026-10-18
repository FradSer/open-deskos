import { readProactiveFile } from './proactive-private.mjs'

/** Fixed operator-selected services. Remote text cannot select an endpoint or credential. */
export class ProviderConfigurationError extends Error {
  constructor(code) { super('Provider configuration or credential unavailable'); this.code = code }
}
const services = {
  typesafe: { env: 'TYPESAFE_API_KEY', file: 'ODK_JEV_KEY_FILE' },
  opencode: { env: 'OPENCODE_API_KEY', file: 'ODK_OPENCODE_KEY_FILE' },
  'opencode-go': { env: 'OPENCODE_GO_API_KEY', file: 'ODK_OPENCODE_GO_KEY_FILE' },
}
/** @param {string} provider @param {string} role */
export function resolveProviderEndpoint(provider, role) {
  if (provider === 'typesafe' && role === 'systemone') return 'https://api.typesafe.ai/v1/systemone'
  if (provider !== 'opencode' && provider !== 'opencode-go') throw new ProviderConfigurationError('configuration')
  const root = `https://opencode.ai/inference${provider === 'opencode-go' ? '/go' : ''}`
  if (role === 'systemone' && provider === 'opencode') return root + '/systemone/v1/systemone'
  if (role === 'openai-completions' || role === 'openai-responses') return root + '/openai/v1'
  if (role === 'anthropic-messages') return root + '/anthropic'
  if (role === 'google-generative-ai' && provider === 'opencode') return root + '/google/v1beta'
  throw new ProviderConfigurationError('configuration')
}
function credential(value) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x20\x7f]/.test(value.trim())) throw new ProviderConfigurationError('configuration')
  return value.trim()
}
/** Resolve only this provider's explicit environment or private file. Never inspect another service. */
export function resolveProviderCredential(provider, { env = process.env, required = true } = {}) {
  const service = services[provider]
  if (!service) throw new ProviderConfigurationError('configuration')
  const direct = env[service.env]
  if (direct !== undefined) return credential(direct)
  const file = env[service.file]
  if (file !== undefined) {
    try { return credential(readProactiveFile(file, 4096)) }
    catch (error) {
      if (error instanceof ProviderConfigurationError) throw error
      throw new ProviderConfigurationError(error?.code === 'ENOENT' ? 'missing_credential' : 'credential_unavailable')
    }
  }
  if (required) throw new ProviderConfigurationError('missing_credential')
  return undefined
}
const configured = new WeakMap()
/** Use the existing SDK registry and transports; do not replace streams, auth storage, or models. */
export async function configureProviderRuntime(runtime, modelRef, { env = process.env } = {}) {
  const provider = typeof modelRef === 'string' ? modelRef.slice(0, modelRef.indexOf('/')) : ''
  if (provider !== 'opencode' && provider !== 'opencode-go') return
  const explicit = resolveProviderCredential(provider, { env, required: false })
  const previous = configured.get(runtime)?.get(provider)
  if (previous && (explicit === undefined || previous === explicit)) return
  let key = explicit
  if (key === undefined) {
    // Both SDK built-ins advertise OPENCODE_API_KEY. Accept only an actual stored
    // credential for the exact provider, never that shared ambient fallback.
    const credentials = await runtime.listCredentials()
    if (credentials.some(item => item.providerId === provider && item.type === 'api_key')) {
      const result = await runtime.getAuth(provider, { env: { OPENCODE_API_KEY: '' } })
      if (result?.source === 'stored credential') key = credential(result.auth?.apiKey)
    }
  }
  if (!key) throw new ProviderConfigurationError('missing_credential')
  const models = runtime.getModels(provider).map(model => ({ ...model, baseUrl: resolveProviderEndpoint(provider, model.api) }))
  if (!models.length || !models.some(model => model.id === modelRef.slice(provider.length + 1))) throw new ProviderConfigurationError('configuration')
  runtime.registerProvider(provider, { models })
  await runtime.setRuntimeApiKey(provider, key)
  let providers = configured.get(runtime)
  if (!providers) { providers = new Map(); configured.set(runtime, providers) }
  providers.set(provider, key)
}
