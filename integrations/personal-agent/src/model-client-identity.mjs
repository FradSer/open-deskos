import { modelRequest } from './model-privacy.mjs'

/** Every Open DeskOS model request names its client, whatever the host's Pi agent directory holds. */
export const ODK_CLIENT_NAME = 'Open deskOS'

// magpie's Usage view cuts a User-Agent at the first ASCII space. UTF-8 U+00A0
// is written as two latin1 characters so undici emits bytes C2 A0; Go reads one
// token and the browser renders a space.
const ESCAPED_SPACE = '\u00c2\u00a0'

export function clientName(env = process.env) {
  const value = env.ODK_MODEL_CLIENT_NAME
  return typeof value === 'string' && value.trim() ? value.trim() : ODK_CLIENT_NAME
}

export function openDeskOSClientHeaders(name = clientName()) {
  const escaped = name.replace(/ /g, ESCAPED_SPACE)
  return { 'User-Agent': escaped, 'X-Client-Name': escaped }
}

/**
 * The Magpie Hy4 route enables reasoning even when Pi omits the option.
 * @param {import('@earendil-works/pi-ai').Model<import('@earendil-works/pi-ai').Api>} model
 * @param {import('@earendil-works/pi-ai').SimpleStreamOptions} [options]
 * @param {number} [tokenLimit]
 */
export function hy4OptionsWithoutReasoning(model, options = {}, tokenLimit) {
  if (model.provider !== 'magpie' || model.id !== 'hunyuan-eval/hy4-dev' || model.api !== 'openai-completions') return options
  return {
    ...options,
    reasoning: undefined,
    maxRetries: 0,
    ...(tokenLimit === undefined ? {} : { maxTokens: Math.min(tokenLimit, options.maxTokens > 0 ? options.maxTokens : tokenLimit) }),
    onPayload: async (payload, effectiveModel) => {
      const transformed = await options.onPayload?.(payload, effectiveModel)
      const body = transformed === undefined ? payload : transformed
      return body && typeof body === 'object' && !Array.isArray(body) ? { ...body, reasoning_effort: 'none' } : body
    },
  }
}

const REQUEST_METHODS = new Set(['stream', 'streamSimple', 'complete', 'completeSimple', 'classify', 'generateImages'])
const clients = new WeakSet()

/**
 * Wrap a ModelRuntime at the provider boundary. Keep identity, auth and
 * routing independent of the request's private content.
 */
export function withOpenDeskOSClient(runtime, name = clientName()) {
  if (!runtime || typeof runtime !== 'object') throw Error('a model runtime is required')
  if (clients.has(runtime)) return runtime
  const headers = openDeskOSClientHeaders(name)
  const client = new Proxy(runtime, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      const bound = value.bind(target)
      if (typeof property !== 'string' || !REQUEST_METHODS.has(property)) return bound
      return (model, context, options = {}, ...rest) => modelRequest(property, bound, model, context, {
        ...options,
        headers: { ...(options?.headers ?? {}), ...headers },
      }, rest)
    },
  })
  clients.add(client)
  return client
}
