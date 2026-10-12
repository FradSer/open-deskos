'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { runCommand } = require('./hydra-wire-lifecycle')

function viewTimeouts(platform = process.platform, arch = process.arch) {
  const arm = platform === 'linux' && arch === 'arm64'
  return {
    fixture: arm ? 150000 : 45000, child: arm ? 160000 : 55000, test: arm ? 180000 : 60000,
    guardChild: arm ? 60000 : 12000, guardTest: arm ? 65000 : 15000,
    externalGuardChild: arm ? 60000 : 18000, externalGuardTest: arm ? 65000 : 20000,
  }
}

async function installPiViews(root, env, { mode = 'native', omitPage = false, captured, signal } = {}) {
  assert.ok(['development', 'native'].includes(mode))
  assert.ok(path.isAbsolute(root))
  const signedViews = mode === 'native'
  if (!captured) {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/renderer/plugins/pi-sessions.js'), 'utf8')
    const ending = "})(typeof window !== 'undefined' ? window : globalThis)"
    assert.ok(source.endsWith(ending + '\n'))
    captured = source.slice(0, source.lastIndexOf(ending)) + '})(captureRoot)'
  }
  const keys = signedViews ? crypto.generateKeyPairSync('ed25519') : null
  const keyring = path.join(root, 'pi-surface-publishers.json')
  if (signedViews) {
    fs.writeFileSync(keyring, JSON.stringify({ schemaVersion: 1, publishers: {
      ...JSON.parse(fs.readFileSync(env.OPEN_DESKOS_NATIVE_KEYRING, 'utf8')).publishers,
      'pi-surface-fixture': { publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }),
        identities: ['odk.app.pi-sessions', 'odk.page.pi-sessions'], hosts: ['electron-renderer'] },
    } }))
    env.OPEN_DESKOS_NATIVE_KEYRING = keyring
  }
  const bundle = (kind, version) => {
    assert.ok(['app', 'page'].includes(kind) && ['2.0.0', '3.0.0'].includes(version))
    const id = `odk.${kind}.pi-sessions`
    const directory = path.join(root, `external-${kind}-${version}`)
    fs.mkdirSync(directory)
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, id, name: `Captured Pi ${kind}`, version,
      kind: kind === 'app' ? 'application' : 'surface', host: 'electron-renderer', surfaceKind: kind,
      ...(kind === 'app' ? { appId: 'pi-sessions', appKind: 'ui' } : { surface: 'app' }),
      provides: [{ interface: `odk:surface/${id}/v1` }], requires: [], permissions: [], entry: 'entry.js',
    }))
    fs.writeFileSync(path.join(directory, 'entry.js'), `;(function () {
      const captureRoot = Object.create(window);
      Object.defineProperty(captureRoot, 'odkPlugins', { value: { register(definition) {
        if (definition.id !== ${JSON.stringify(id)}) return;
        window.piExternalExecutions ||= {};
        window.piExternalExecutions[definition.id] = (window.piExternalExecutions[definition.id] || 0) + 1;
        window.piExternalVersions ||= {};
        window.piExternalVersions[definition.id] = ${JSON.stringify(version)};
        ${kind === 'page' && omitPage ? 'return;' : ''}
        window.odkRendererDevelopment.define(definition);
      } } });
      ${captured}
    })();`)
    if (signedViews) {
      const files = ['entry.js', 'manifest.json'].map(name => ({ path: name,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex') }))
      const payload = { schemaVersion: 1, keyId: 'pi-surface-fixture', replace: true, files }
      const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
      fs.writeFileSync(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
    }
    return directory
  }
  for (const kind of ['app', 'page']) {
    const id = `odk.${kind}.pi-sessions`
    const directory = bundle(kind, '2.0.0')
    const args = signedViews ? ['native', 'install', directory, '--keyring', keyring, '--trust']
      : ['link', directory, '--replace', '--trust']
    const receipt = await runCommand(process.execPath, [path.resolve(__dirname, '../../scripts/open-deskos-plugin-cli.js'), ...args],
      { env: { ...env, ELECTRON_RUN_AS_NODE: '1' }, signal, timeout: 10000 })
    if (signedViews) assert.equal(JSON.parse(receipt.stdout).effect, 'selection-only')
    else assert.ok(receipt.stdout.includes(`Development plugin "${id}" linked for the next Shell startup.`))
  }
  return { bundle, keyring }
}

module.exports = { installPiViews, viewTimeouts }
