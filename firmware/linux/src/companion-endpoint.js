const DEFAULT_COMPANION_HOST = '127.0.0.1'
const DEFAULT_COMPANION_PORT = '8788'

function resolveCompanionHealthUrl(env = process.env) {
  const explicitUrl = env.ODK_COMPANION_HEALTH_URL?.trim()
  if (explicitUrl) return explicitUrl

  const host = (env.ODK_COMPANION_HOST || DEFAULT_COMPANION_HOST).trim()
  const port = (env.ODK_COMPANION_PORT || DEFAULT_COMPANION_PORT).trim()
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  return `http://${hostPart}:${port}/health`
}

module.exports = {
  DEFAULT_COMPANION_HOST,
  DEFAULT_COMPANION_PORT,
  resolveCompanionHealthUrl,
}
