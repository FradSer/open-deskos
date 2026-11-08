import { loadProactiveConfig, ownerConfigWriter } from './proactive.mjs'

/** One heartbeat every 30 minutes when the owner supplies no configuration. */
export const DEFAULT_PROACTIVE_POLL_MS = 30 * 60 * 1000

export function defaultProactiveConfig() {
  return { version: 2, pollMs: DEFAULT_PROACTIVE_POLL_MS, maxAgeMs: 300000, cooldownMs: 60000,
    maxCandidates: 8, maxPush: 3, rules: [], suppressed: [], snoozed: {} }
}

/**
 * An owner file stays authoritative. Its absence starts the bounded default
 * Watch, but cannot create owner suppression writes.
 */
export function resolveProactiveConfig({ env = process.env, loadConfig = loadProactiveConfig, createWriter = ownerConfigWriter } = {}) {
  const ownerFile = env.ODK_PROACTIVE_CONFIG
  if (!ownerFile) return { config: defaultProactiveConfig(), save: async () => { throw Error('No owner rule file selected') } }
  const config = loadConfig(ownerFile)
  return { config, save: createWriter(ownerFile, config) }
}
