'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const { runCommand } = require('./hydra-wire-lifecycle')

async function installBuiltinViews(profile, env, { mode = 'native', invalid = false, omitApp, signal } = {}) {
  assert.ok(path.isAbsolute(profile) && ['development', 'native'].includes(mode))
  const keys = mode === 'native' ? crypto.generateKeyPairSync('ed25519') : null
  const keyring = path.join(profile, 'publishers.json')
  if (keys) {
    env.ODK_NATIVE_KEYRING = keyring
    await fs.writeFile(keyring, JSON.stringify({ schemaVersion: 1, publishers: { views: {
      publicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }),
      identities: ['pomodoro', 'year', 'app-manager'].map(id => `odk.app.${id}`),
      hosts: ['electron-renderer'],
    } } }))
  }
  let source = await fs.readFile(path.join(__dirname, '../fixtures/builtin-view-replacements.js'), 'utf8')
  if (invalid) source = source.replace("text(value, Math.round(100 * (now.getTime() - boundaries[0]) / (boundaries[1] - boundaries[0])) + '%')", "text(value, 'wrong')")
  for (const version of mode === 'native' ? ['2.0.0', '3.0.0'] : ['2.0.0']) {
    for (const appId of ['pomodoro', 'year', 'app-manager']) {
      const id = `odk.app.${appId}`
      const directory = path.join(profile, `${appId}-${version}`)
      await fs.mkdir(directory)
      await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
        schemaVersion: 1, id, name: `Independent ${appId} view`, version, kind: 'application',
        host: 'electron-renderer', surfaceKind: 'app', appId, appKind: 'ui',
        provides: [{ interface: `odk:surface/${id}/v1` }], requires: [], permissions: [], entry: 'entry.js',
      }))
      assert.ok(source.includes("version: '2.0.0'"))
      await fs.writeFile(path.join(directory, 'entry.js'), source.replace("version: '2.0.0'", `version: '${version}'`) + `;
  window.viewExternalEntries ||= [];
  window.viewExternalEntries.push(${JSON.stringify(id)});
  window.viewExecutedVersions ||= {};
  window.viewExecutedVersions[${JSON.stringify(id)}] = ${JSON.stringify(version)};
  if (${appId !== omitApp}) window.odkRendererDevelopment.define(window.odkBuiltinViewReplacements.find(definition => definition.id === ${JSON.stringify(id)}));
  `)
      if (keys) {
        const files = []
        for (const name of ['entry.js', 'manifest.json']) files.push({ path: name,
          sha256: crypto.createHash('sha256').update(await fs.readFile(path.join(directory, name))).digest('hex') })
        const payload = { schemaVersion: 1, keyId: 'views', replace: true, files }
        const signature = crypto.sign(null, Buffer.from(`Open DeskOS native bundle v1\n${JSON.stringify(payload)}`), keys.privateKey).toString('base64')
        await fs.writeFile(path.join(directory, 'bundle.json'), JSON.stringify({ ...payload, signature }))
      }
      if (version === '2.0.0') {
        const args = keys ? ['native', 'install', directory, '--keyring', keyring, '--trust']
          : ['link', directory, '--trust', '--replace']
        const receipt = await runCommand(process.execPath, [path.resolve(__dirname, '../../scripts/odk-plugin-cli.js'),
          ...args], { env, signal, timeout: 10000 })
        if (keys) assert.equal(JSON.parse(receipt.stdout).effect, 'selection-only')
      }
    }
  }
}

function builtinViewTimeouts(mode) {
  // Signed acceptance has five phases and ten revision commands; other modes have three phases.
  return mode === 'native'
    ? { fixture: 60000, child: 65000, test: 90000 }
    : { fixture: 30000, child: 35000, test: 45000 }
}

module.exports = { installBuiltinViews, builtinViewTimeouts }
