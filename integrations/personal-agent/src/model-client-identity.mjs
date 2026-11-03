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

const REQUEST_METHODS = new Set(['stream', 'streamSimple', 'complete', 'completeSimple', 'classify'])

/**
 * Wrap a ModelRuntime so every request carries the client name. Pi merges
 * request headers last, so this wins without mutating models.json or auth.
 * All other methods keep their original receiver and behavior.
 */
export function withOpenDeskOSClient(runtime, name = clientName()) {
  if (!runtime || typeof runtime !== 'object') throw Error('a model runtime is required')
  const headers = openDeskOSClientHeaders(name)
  return new Proxy(runtime, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      const bound = value.bind(target)
      if (typeof property !== 'string' || !REQUEST_METHODS.has(property)) return bound
      return (model, context, options = {}, ...rest) => bound(model, context, {
        ...options,
        headers: { ...(options?.headers ?? {}), ...headers },
      }, ...rest)
    },
  })
}
