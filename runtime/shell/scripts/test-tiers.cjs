'use strict'
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const testsDir = path.join(root, 'tests')

// A test file belongs to the acceptance tier when it can start a graphical
// Electron process. The scan covers test files only. Helpers that set
// ELECTRON_RUN_AS_NODE=1 run the Electron binary as a Node CLI, so their
// consumers stay in the fast tier.
const launchMarkers = [
  /require\(['"]electron['"]\)/,
  /isolatedElectronArgs\(/,
  /runFixture\(/,
  /electron-fixture-runner/,
  /ELECTRON_RUN_AS_NODE/,
]

// The reference host keeps two acceptance workers to avoid Mali GPU process
// crashes. Its eight cores run four fast workers so kiosk services keep room.
// Other hosts run eight fast workers. An explicit override wins on any host.
function concurrencyFor(platform = process.platform, arch = process.arch, env = process.env) {
  const fallback = platform === 'linux' && arch === 'arm64' ? 4 : 8
  const override = Number.parseInt(env.ODK_TEST_FAST_CONCURRENCY ?? '', 10)
  return { fast: Number.isInteger(override) && override > 0 ? override : fallback, acceptance: 2 }
}

function plan(tier, dir = testsDir) {
  const concurrency = concurrencyFor()
  if (!Object.hasOwn(concurrency, tier)) throw new Error(`Unknown test tier: ${tier}`)
  const fast = []
  const acceptance = []
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.test.js')).sort()) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    const bucket = launchMarkers.some(marker => marker.test(source)) ? acceptance : fast
    bucket.push(path.join(dir, file))
  }
  return { tier, concurrency: concurrency[tier], files: tier === 'fast' ? fast : acceptance }
}

function main() {
  const tier = process.argv[2]
  let selected
  try {
    selected = plan(tier)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 2
    return
  }
  if (process.argv.includes('--list')) {
    console.log(JSON.stringify(selected))
    return
  }
  console.error(`[test-tiers] ${tier}: ${selected.files.length} files, concurrency ${selected.concurrency}`)
  const child = spawn(process.execPath,
    ['--test', `--test-concurrency=${selected.concurrency}`, ...selected.files],
    { cwd: root, stdio: 'inherit' })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code, signal) => { process.exitCode = code === null ? (signal ? 1 : 0) : code })
}

if (require.main === module) main()

module.exports = { plan, concurrencyFor }
