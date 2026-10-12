import { after } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { access, copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

let launcher
let directory
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })
async function windowsLauncher() {
  directory = await mkdtemp(join(tmpdir(), 'bot-node-launcher-'))
  const executable = join(directory, 'launcher.exe')
  const compiler = join(process.env.SystemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
  await access(compiler)
  await promisify(execFile)(compiler, ['/nologo', '/target:exe', '/out:' + executable,
    fileURLToPath(new URL('./node-fixture-launcher.cs', import.meta.url))], { windowsHide: true, timeout: 15000 })
  return executable
}

export async function nodeExecutable(t, file) {
  if (process.platform !== 'win32') return file
  launcher ??= windowsLauncher()
  const executable = file + '.exe'
  const script = file + '.js'
  const source = (await readFile(file, 'utf8')).replace(/^#![^\n]*\n/, '')
  await writeFile(script, source)
  await copyFile(await launcher, executable)
  await writeFile(executable + '.paths', process.execPath + '\n' + script + '\n')
  return executable
}
