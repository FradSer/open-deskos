import { clientChannelToken, channelRequiresToken, channelRequest, requestId, resolveChannelEndpoint } from './runtime-channel.mjs'

/**
 * The application control endpoint on this host: a named pipe the Shell Host
 * names for the link, or the runtime directory socket on a Unix host. The
 * override exists for tests; production takes the host's own naming, which is why
 * a Windows desk needs no `ODESK_APPS_CONTROL_SOCKET` to reach the Shell.
 */
export function appsControlEndpoint(env = process.env, platform = process.platform) {
  return resolveChannelEndpoint({
    name: 'user-app-control',
    override: env.ODESK_APPS_CONTROL_SOCKET,
    unixSubdirectory: 'open-deskos-apps',
    unixFilename: 'control.sock',
    env,
    platform,
  })
}

const INSTALL_TIMEOUT_MS = 30_000
const REQUEST_TIMEOUT_MS = 10_000

/**
 * One request over the Shell's application control endpoint.
 *
 * A missing Shell, a missing token and a refused command are each reported as
 * what they are, and none of them may surface as a platform error: a host that
 * has no `process.getuid` is a Windows host, not a broken one.
 *
 * @param {string} command
 * @param {{ appId?: string, signal?: AbortSignal, placement?: unknown, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, connect?: typeof import('node:net').createConnection }} [request]
 */
export async function userAppsRequest(command, { appId, signal, placement, env = process.env, platform = process.platform, connect } = {}) {
  const endpoint = appsControlEndpoint(env, platform)
  if (!endpoint) throw Error('Application lifecycle unavailable: this host has no application control endpoint to reach')
  const tokenRequired = channelRequiresToken(endpoint, platform)
  const token = tokenRequired ? await clientChannelToken({ env, platform }) : null
  return await channelRequest({
    endpoint,
    label: 'Application lifecycle',
    timeoutMs: command === 'install' ? INSTALL_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    token,
    tokenRequired,
    signal,
    connect,
    payload: { v: 1, id: requestId(), command, ...(appId ? { appId } : {}), ...(placement ? { placement } : {}) },
  })
}
