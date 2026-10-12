'use strict'

const path = require('node:path')
const crypto = require('node:crypto')
const platform = require('../../src/platform')
const resolve = platform.resolveShellHost

function prefix(root) {
  return '\\\\.\\pipe\\odk-test-' + crypto.createHash('sha256').update(root).digest('hex').slice(0, 32) + '-'
}

function privateEndpoint(root, name) {
  return process.platform === 'win32' ? prefix(root) + name : path.join(root, name)
}

function diagnosticChannel(root) {
  const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: root, LOCALAPPDATA: root,
    ODK_CONFIG_DIR: path.join(root, 'config'), ODK_TEST_PRIVATE_PIPE_PREFIX: prefix(root),
    ODK_TEST_DIAGNOSTIC_ENDPOINT: process.platform === 'win32' ? prefix(root) + 'plugin-diagnostics' : path.join(root, 'diag.sock') }
  const host = resolve({ env })
  return { endpoint: env.ODK_TEST_DIAGNOSTIC_ENDPOINT,
    stateDir: host.stateDir, tokenFile: host.localChannelTokenFile, platform: host.platform, env }
}

// Only child CLI fixtures load this file with --require. Production naming is unchanged.
if (process.execArgv.some((arg, index, args) => arg === '--require' && path.resolve(args[index + 1] || '') === __filename)) {
  platform.resolveShellHost = options => {
    const env = options?.env || process.env
    if (process.platform === 'win32' && !/^\\\\\.\\pipe\\odk-test-[a-f0-9]{32}-$/.test(env.ODK_TEST_PRIVATE_PIPE_PREFIX || '')) throw Error('Private test pipe prefix required')
    if (process.platform !== 'win32' && !path.isAbsolute(env.ODK_TEST_DIAGNOSTIC_ENDPOINT || '')) throw Error('Private test diagnosis endpoint required')
    const host = resolve(options)
    if (process.platform !== 'win32') return { ...host, endpoint: name => name === 'plugin-diagnostics' ? env.ODK_TEST_DIAGNOSTIC_ENDPOINT : host.endpoint(name) }
    return { ...host, endpoint: name => host.endpoint(name) === null ? null : env.ODK_TEST_PRIVATE_PIPE_PREFIX + name,
      odkDataEndpoint: env.ODK_TEST_PRIVATE_PIPE_PREFIX + 'odk-data' }
  }
}

module.exports = { privateEndpoint, diagnosticChannel }

async function serviceChannel(root) {
  const stateDir = path.join(root, 'state')
  if (process.platform !== 'win32') return { endpoint: path.join(root, 'service.sock'), stateDir, channelToken: '', tokenFile: path.join(stateDir, 'local-channel.token') }
  const net = require('node:net')
  const server = net.createServer()
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes) })
  const port = server.address().port
  await new Promise(resolve => server.close(resolve))
  const channelToken = await require('../../src/local-channel').readOrCreateToken({ stateDir })
  return { endpoint: `tcp://127.0.0.1:${port}`, stateDir, channelToken, tokenFile: path.join(stateDir, 'local-channel.token') }
}

module.exports.serviceChannel = serviceChannel
module.exports.connectEndpoint = endpoint => require('../../src/local-channel').parseTcpEndpoint(endpoint) || endpoint
module.exports.pythonExecutable = process.platform === 'win32' ? 'python' : 'python3'
