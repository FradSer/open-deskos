import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RUNTIME_FILES } from './package.mjs'

/** Publish only reviewed source inputs. Operator bindings remain outside this snapshot. */
export async function buildServicePackage({ destination, image, platform = 'linux/arm64' }) {
  if (typeof destination !== 'string' || !isAbsolute(destination) || resolve(destination) !== destination
      || !/^(?:sha256:[a-f0-9]{64}|[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64})$/.test(image ?? '')
      || !['linux/arm64', 'linux/amd64'].includes(platform)) throw Error('Canonical package destination and immutable Docker image required')
  try { await lstat(destination); throw Error('Service package destination exists') } catch (error) { if (error.code !== 'ENOENT') throw error }
  await mkdir(dirname(destination), { recursive: true })
  const staging = await mkdtemp(join(dirname(destination), '.gmail-service-'))
  try {
    const source = fileURLToPath(new URL('..', import.meta.url))
    const files = []
    for (const path of [...RUNTIME_FILES].sort()) {
      const info = await lstat(join(source, path))
      if (!info.isFile() || info.nlink !== 1 || info.size > 1048576) throw Error('Unsafe Gmail runtime input')
      const data = await readFile(join(source, path))
      await mkdir(dirname(join(staging, path)), { recursive: true })
      await writeFile(join(staging, path), data)
      files.push({ path, sha256: createHash('sha256').update(data).digest('hex') })
    }
    const manifest = { schemaVersion: 1, id: 'odk.gmail.reader', name: 'Gmail read-only service', version: '0.1.1', files,
      runtime: { kind: 'docker', image, platform, args: [] },
      health: { kind: 'exec', argv: ['node', '/app/src/healthcheck.mjs'], timeoutSeconds: 10 }, stopTimeoutSeconds: 20 }
    await writeFile(join(staging, 'service.json'), JSON.stringify(manifest, null, 2) + '\n')
    await rename(staging, destination)
    return manifest
  } finally { await rm(staging, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length < 4 || process.argv.length > 5) throw Error('arguments')
    await buildServicePackage({ destination: process.argv[2], image: process.argv[3], platform: process.argv[4] })
  } catch { process.stderr.write('Use service-package <new absolute directory> <immutable image> [linux/arm64|linux/amd64].\n'); process.exitCode = 1 }
}
