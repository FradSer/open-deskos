/** Configure one Pi agent directory to use the shared Open deskOS model gateway. */
import { parseArgs } from 'node:util'
import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

// magpie counts a client by the first ASCII-space-separated token of its
// User-Agent. An ASCII space in "Open deskOS" would be cut to "Open", so the
// header escapes it as UTF-8 U+00A0 (two latin1 chars that undici writes as
// bytes C2 A0). magpie reads one token and the Usage view renders a space.
const ESCAPED_SPACE = '\u00c2\u00a0'
const headerClientName = name => name.replace(/ /g, ESCAPED_SPACE)

const DEFAULTS = {
  gatewayUrl: 'http://10.10.0.195:3425/v1',
  modelId: 'hunyuan-eval/hy4-dev',
  providerId: 'magpie',
  providerName: 'magpie',
  clientName: 'Open deskOS',
  keyEnv: 'MAGPIE_API_KEY',
}

function options(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    'models-path': { type: 'string' }, 'gateway-url': { type: 'string' },
    'model-id': { type: 'string' }, 'provider-id': { type: 'string' }, 'provider-name': { type: 'string' },
    'client-name': { type: 'string' }, 'key-env': { type: 'string' },
  } })
  const modelsPath = values['models-path']
  if (!modelsPath || !modelsPath.startsWith('/')) throw Error('absolute --models-path is required')
  return { modelsPath,
    gatewayUrl: (values['gateway-url'] ?? DEFAULTS.gatewayUrl).replace(/\/+$/, ''),
    modelId: values['model-id'] ?? DEFAULTS.modelId,
    providerId: values['provider-id'] ?? DEFAULTS.providerId,
    providerName: values['provider-name'] ?? DEFAULTS.providerName,
    clientName: values['client-name'] ?? DEFAULTS.clientName,
    keyEnv: values['key-env'] ?? DEFAULTS.keyEnv }
}

/** The key stays in the environment; models.json only names the variable. */
function gatewayConfig({ gatewayUrl, modelId, providerId, providerName, clientName, keyEnv }) {
  return {
    providers: {
      [providerId]: {
        name: providerName,
        baseUrl: gatewayUrl,
        api: 'openai-completions',
        apiKey: `$${keyEnv}`,
        authHeader: true,
        headers: { 'User-Agent': headerClientName(clientName), 'X-Client-Name': headerClientName(clientName) },
        compat: { supportsStore: false, maxTokensField: 'max_tokens', supportsDeveloperRole: false },
        models: [{
          id: modelId,
          name: `${modelId} (${providerName})`,
          api: 'openai-completions',
          input: ['text'],
          reasoning: false,
          contextWindow: 128000,
          maxTokens: 16384,
          compat: { supportsStore: false, maxTokensField: 'max_tokens', supportsDeveloperRole: false },
        }],
      },
    },
  }
}

async function replacePrivateJson(path, value, stamp) {
  let backup
  try {
    const existing = await readFile(path, 'utf8')
    backup = `${path}.bak-${stamp}`
    await writeFile(backup, existing, { mode: 0o600 })
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const temporary = `${path}.tmp-${randomUUID()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600)
  return backup
}

async function gatewaySettings(path, { modelId, providerId }) {
  let settings = {}
  try { settings = JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  return { ...settings,
    defaultProvider: providerId,
    defaultModel: modelId,
    enabledModels: [`${providerId}/${modelId}`] }
}

export async function configureModelGateway(argv = process.argv.slice(2)) {
  const selected = options(argv)
  const directory = dirname(selected.modelsPath)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const settingsPath = join(directory, 'settings.json')
  const stamp = String(Date.now())
  const backup = await replacePrivateJson(selected.modelsPath, gatewayConfig(selected), stamp)
  const settingsBackup = await replacePrivateJson(settingsPath, await gatewaySettings(settingsPath, selected), stamp)
  return { modelsPath: selected.modelsPath, settingsPath, backup, settingsBackup,
    gatewayUrl: selected.gatewayUrl, modelId: selected.modelId,
    providerId: selected.providerId, providerName: selected.providerName,
    clientName: selected.clientName, keyEnv: selected.keyEnv }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  configureModelGateway().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
