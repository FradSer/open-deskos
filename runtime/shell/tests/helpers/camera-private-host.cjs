'use strict'

const platform = require('../../src/platform')
if (process.platform === 'win32') {
  const prefix = process.env.ODK_CAMERA_PRIVATE_PIPE_PREFIX
  if (typeof prefix !== 'string' || !/^\\\\\.\\pipe\\odk-camera-[a-f0-9]{32}-$/.test(prefix)) {
    throw Error('Windows acceptance requires a private Camera pipe prefix')
  }
  const resolve = platform.resolveShellHost
  platform.resolveShellHost = options => {
    const host = resolve(options)
    if (host.platform !== 'win32') throw Error('Camera acceptance requires native Windows host resolution')
    const endpoint = name => host.endpoint(name) === null ? null : prefix + name
    return { ...host, endpoint, deskDataEndpoint: endpoint('desk-data') }
  }
}
