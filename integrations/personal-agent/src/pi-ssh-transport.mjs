import { spawn } from 'node:child_process'
import { sshEnvironment } from './ssh-environment.mjs'

// OpenSSH can add SendEnv patterns from configuration after command-line
// exclusions. Give it only connection-related environment values to forward.
const [program, ...args] = process.argv.slice(2)
const child = spawn(program, args, { stdio: 'inherit', env: sshEnvironment() })
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) process.on(signal, () => { child.kill(signal) })
child.once('error', () => { console.error('Pi SSH transport could not start'); process.exitCode = 1 })
child.once('exit', code => { process.exitCode = code ?? 1 })
