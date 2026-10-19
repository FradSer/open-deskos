import { spawn } from 'node:child_process'
import { Duplex, Readable, Writable } from 'node:stream'

export function mainAlias(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) throw Error('CM5 SSH alias required')
  return value
}

export function connectMain(alias, { spawnProcess = spawn } = {}) {
  const child = spawnProcess('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'IdentitiesOnly=yes', '-o', 'ClearAllForwardings=yes', '-o', 'ForwardAgent=no',
    '-o', 'ForwardX11=no', '-o', 'PermitLocalCommand=no', '-o', 'ConnectTimeout=8',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', mainAlias(alias),
    'odk-personal-agent-link'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
  const stream = Duplex.fromWeb({ readable: Readable.toWeb(child.stdout), writable: Writable.toWeb(child.stdin) })
  child.on('error', () => stream.destroy())
  child.once('close', () => stream.destroy())
  stream.once('close', () => { if (child.exitCode === null) child.kill() })
  return stream
}
