import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const source = fileURLToPath(new URL('..', import.meta.url))
export const RUNTIME_FILES = ['Dockerfile', 'package.json', 'pnpm-lock.yaml', 'README.md', 'skills/gmail-reading/SKILL.md',
  ...['cli', 'client', 'credentials', 'daemon', 'healthcheck', 'index', 'manifest', 'oauth', 'server', 'socket-bridge', 'socket-path', 'socket-transport'].map(name => `src/${name}.mjs`)]
const files = RUNTIME_FILES

/** Build a local runtime archive without reading operator credentials or installed dependencies. */
export async function packageGmail({ outputDirectory }) {
  if (typeof outputDirectory !== 'string' || !isAbsolute(outputDirectory)) throw Error('An absolute output directory is required')
  const manifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(manifest.version)) throw Error('Invalid plugin package version')
  await mkdir(outputDirectory, { recursive: true })
  const staging = await mkdtemp(join(outputDirectory, '.gmail-package-'))
  const archive = join(outputDirectory, `odk-gmail-plugin-${manifest.version}.tgz`)
  try {
    for (const file of files) {
      const target = join(staging, 'package', file)
      await mkdir(dirname(target), { recursive: true })
      await copyFile(join(source, file), target)
    }
    const temporaryArchive = join(staging, 'plugin.tgz')
    await run('tar', ['-czf', temporaryArchive, '-C', staging, ...files.map(file => `package/${file}`)])
    await copyFile(temporaryArchive, archive, constants.COPYFILE_EXCL)
    return { archive }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('Usage: pnpm package /absolute/output-directory')
    console.log(JSON.stringify(await packageGmail({ outputDirectory: process.argv[2] })))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Gmail packaging failed')
    process.exitCode = 1
  }
}
