#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve, relative, dirname, join, sep, isAbsolute } from 'node:path'
import { spawnSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const slash = value => value.split(sep).join('/')
const inside = (file, directory) => file === directory || file.startsWith(`${directory}/`)
const ignored = new Set(['node_modules', '.git', '.claude', '.pi', '.venv', 'build', 'dist', 'managed_components', '__pycache__'])
function files(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
function localPath(value) {
  if (typeof value !== 'string' || !value || isAbsolute(value)) throw Error(`Invalid project path: ${value}`)
  const path = slash(relative(root, resolve(root, value)))
  if (path === '..' || path.startsWith('../')) throw Error(`Path escapes repository: ${value}`)
  return path || '.'
}
function inventory() {
  const manifest = JSON.parse(readFileSync(join(root, 'monorepo.json'), 'utf8'))
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.projects)) throw Error('Unsupported inventory schema')
  const scopes = [...readFileSync(join(root, '.git-agent/config.yml'), 'utf8').matchAll(/^\s*- name:\s*(\S+)/gm)].map(match => match[1])
  if (new Set(scopes).size !== scopes.length) throw Error('Duplicate owner scopes in .git-agent/config.yml')
  const ids = new Set(), roots = new Set(), packageNames = new Set()
  for (const project of manifest.projects) {
    if (!/^[a-z][a-z0-9-]*$/.test(project.id) || ids.has(project.id)) throw Error(`Invalid or duplicate project ID: ${project.id}`)
    project.root = localPath(project.root)
    if (roots.has(project.root)) throw Error(`Duplicate project root: ${project.root}`)
    if (!existsSync(join(root, project.root))) throw Error(`Missing project root: ${project.root}`)
    if (!scopes.includes(project.owner)) throw Error(`Invalid owner scope: ${project.id}: ${project.owner}`)
    if (project.kind === 'node') {
      if (typeof project.packageName !== 'string' || !project.packageName || packageNames.has(project.packageName)) throw Error(`Missing or duplicate package name: ${project.id}`)
      packageNames.add(project.packageName)
    }
    ids.add(project.id); roots.add(project.root)
    for (const [name, command] of Object.entries(project.commands ?? {})) {
      if (!Array.isArray(command.argv) || !command.argv.length || !command.argv.every(item => typeof item === 'string' && item.length) || !['check', 'manual'].includes(command.mode)) throw Error(`Invalid command: ${project.id}/${name}`)
      if (command.mode === 'manual' && !command.reason) throw Error(`Manual command needs reason: ${project.id}/${name}`)
    }
    if (project.installRoot) localPath(project.installRoot)
  }
  for (const project of manifest.projects) {
    for (const dependency of project.dependsOn ?? []) if (!ids.has(dependency)) throw Error(`Unknown dependency: ${project.id}/${dependency}`)
    if (project.installRoot && !manifest.projects.some(candidate => candidate.root === project.installRoot && candidate.kind === 'node')) throw Error(`Unknown installRoot: ${project.id}`)
  }
  return manifest
}
function imports(source) {
  // Tokenize first so mail, prompts, comments, and whitebox file paths are not edges.
  // Computed imports and template expressions are outside this static check.
  const tokens = [...source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|[A-Za-z_$][\w$]*|[^\s]/g)]
    .map(match => match[0]).filter(token => !token.startsWith('//') && !token.startsWith('/*'))
  const edges = []
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!/^["']/.test(token)) continue
    const previous = tokens[i - 1]
    const dynamic = previous === '(' && ['import', 'require'].includes(tokens[i - 2]) && tokens[i - 3] !== '.'
    if (previous !== 'from' && previous !== 'import' && !dynamic) continue
    if (previous === 'from' && tokens[i - 2] === '.') continue
    edges.push(token.slice(1, -1).replace(/\\([\\'"/])/g, '$1'))
  }
  return edges
}
function check(manifest) {
  const errors = []
  if (existsSync(join(root, 'pnpm-workspace.yaml'))) errors.push('Root pnpm workspace is not supported: preserve independent installs')
  for (const project of manifest.projects) {
    if (project.lockfile && !existsSync(join(root, project.root, localPath(project.lockfile)))) errors.push(`Missing independent lockfile: ${project.id}`)
  }
  for (const project of manifest.projects.filter(project => project.kind === 'node')) {
    const file = join(root, project.root, 'package.json')
    if (!existsSync(file)) { errors.push(`Missing package.json: ${project.root}`); continue }
    if (JSON.parse(readFileSync(file, 'utf8')).name !== project.packageName) errors.push(`Package name mismatch: ${project.id}`)
    if (!project.lockfile) errors.push(`Missing independent lockfile: ${project.id}`)
  }
  const activeFiles = ['package.json', ...['runtime', 'integrations', 'peripherals', 'experiments', 'tools'].flatMap(directory => files(join(root, directory))).map(file => slash(relative(root, file)))]
  for (const file of activeFiles.filter(file => file.endsWith('package.json') && existsSync(join(root, file)) && !file.split('/').some(part => ['tests', 'test', 'fixtures'].includes(part)))) {
    if (!manifest.projects.some(project => project.kind === 'node' && project.root === (slash(dirname(file)) || '.'))) errors.push(`unregistered Node package: ${dirname(file)}`)
  }
  const boundary = manifest.boundaries?.recommendations
  const renderer = manifest.boundaries?.rendererRoots ?? []
  const backends = manifest.boundaries?.backendRoots ?? []
  const sourceRoots = new Set(manifest.projects.filter(project => project.root !== '.').map(project => project.root))
  for (const directory of renderer) sourceRoots.add(directory)
  const sources = new Set([...sourceRoots].flatMap(directory => files(join(root, directory))))
  for (const directory of ['tools', 'tests']) for (const file of files(join(root, directory))) sources.add(file)
  for (const file of sources) {
    if (!/\.(?:[cm]?js|[jt]sx?|mts|cts)$/.test(file)) continue
    const sourcePath = slash(relative(root, file))
    for (const specifier of imports(readFileSync(file, 'utf8'))) {
      const target = specifier.startsWith('.') ? slash(relative(root, resolve(dirname(file), specifier))) : null
      if (renderer.some(directory => inside(sourcePath, directory)) && (target && backends.some(directory => inside(target, directory)) || (manifest.boundaries?.backendPackages ?? []).some(name => specifier === name || specifier.startsWith(`${name}/`)))) errors.push(`renderer imports backend: ${sourcePath} -> ${specifier}`)
      if (!boundary) continue
      const internal = inside(sourcePath, boundary.root)
      if (!internal && target && inside(target, boundary.root) && target !== `${boundary.root}/${boundary.entry}`) errors.push(`Use recommendations public entry: ${sourcePath} -> ${specifier}`)
      if (!internal) continue
      if (target && !inside(target, boundary.root) && !(boundary.reviewedPeers ?? []).some(peer => target === slash(relative(root, resolve(root, boundary.root, peer))))) errors.push(`recommendations unreviewed peer: ${sourcePath} -> ${specifier}`)
      if (!target && !builtinModules.includes(specifier.replace(/^node:/, '')) && !(boundary.allowedPackages ?? []).some(name => specifier === name || specifier.startsWith(`${name}/`))) errors.push(`recommendations unreviewed package: ${sourcePath} -> ${specifier}`)
    }
  }
  if (errors.length) throw Error(errors.join('\n'))
  console.log(`Repository checks passed (${manifest.projects.length} registered projects; static module edges only).`)
  if (manifest.boundaries?.recordedDynamicLoaders?.length) console.log('Computed loaders require manual review; recorded targets are not enforced by this static check.')
}
function affected(manifest, args) {
  if (args.length !== 2 || args[0] !== '--since' || !args[1] || args[1].startsWith('-')) throw Error('Usage: repo affected --since <ref>')
  const base = spawnSync('git', ['rev-parse', '--verify', `${args[1]}^{commit}`], { cwd: root, encoding: 'utf8' })
  if (base.status !== 0) throw Error('Invalid Git reference')
  const result = spawnSync('git', ['diff', '--name-only', '-z', base.stdout.trim(), '--'], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) throw Error(result.stderr || 'Git diff failed')
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' })
  if (untracked.status !== 0) throw Error('Git untracked inventory failed')
  const changed = `${result.stdout}${untracked.stdout}`.split('\0').filter(Boolean)
  console.log(JSON.stringify(affectedProjectIds(manifest, changed), null, 2))
}

export function affectedProjectIds(manifest, changed) {
  const all = changed.some(file => ['monorepo.json', 'package.json', 'pnpm-lock.yaml', '.git-agent/config.yml', 'tools/repo.mjs', 'tests/repo-management.test.mjs', 'features/repository.feature', 'AGENTS.md'].includes(file) || file.startsWith('.github/workflows/'))
  const selected = new Set(manifest.projects.filter(project => all || changed.some(file => project.root !== '.' && inside(file, project.root))).map(project => project.id))
  let grew = true
  while (grew) {
    grew = false
    for (const project of manifest.projects) if (!selected.has(project.id) && (project.dependsOn ?? []).some(id => selected.has(id))) { selected.add(project.id); grew = true }
  }
  return manifest.projects.filter(project => selected.has(project.id)).map(project => project.id)
}

function main() {
try {
  const [command, ...args] = process.argv.slice(2)
  const manifest = inventory()
  if (command === 'list' && !args.length) console.log(JSON.stringify(manifest.projects, null, 2))
  else if (command === 'check' && !args.length) check(manifest)
  else if (command === 'affected') affected(manifest, args)
  else if (command === 'run' && args.length === 2) {
    const project = manifest.projects.find(project => project.id === args[0])
    const task = project?.commands?.[args[1]]
    if (!task) throw Error(`Unknown project command: ${args.join('/')}`)
    if (task.mode === 'manual') { console.error(`manual: ${project.id}/${args[1]}: ${task.reason}`); process.exitCode = 2 }
    else {
      const result = spawnSync(task.argv[0], task.argv.slice(1), { cwd: resolve(root, project.root), stdio: 'inherit', shell: false })
      if (result.error) console.error(result.error.message)
      process.exitCode = result.status ?? 1
    }
  } else throw Error('Usage: repo list | check | run <id> <command> | affected --since <ref>')
} catch (error) { console.error(error.message); process.exitCode = 1 }

}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main()
