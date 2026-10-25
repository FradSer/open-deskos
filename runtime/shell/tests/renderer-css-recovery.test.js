'use strict'
const { isolatedElectronArgs } = require('./helpers/electron-fixture')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const execute = require('node:util').promisify(require('node:child_process').execFile)

test('actual Electron restores packaged CSS or retains external CSS through failed recovery', { timeout: 35000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-css-recovery-'))
  const env = { ...process.env, ODK_CSS_RECOVERY_PROFILE: root }
  delete env.ELECTRON_RUN_AS_NODE
  try {
    const scripts = ['src/plugin-host.js', 'src/renderer/core/registry.js'].map(file => pathToFileURL(path.resolve(file)).href)
    await fs.writeFile(path.join(root, 'index.html'), `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="shell.css">
      ${scripts.map(url => `<script src="${url}"></script>`).join('\n')}</head><body><script src="setup.js"></script></body></html>`)
    await fs.writeFile(path.join(root, 'shell.css'), '#reading { width: 11px; }')
    await fs.writeFile(path.join(root, 'default.css'), '#reading { width: 17px; }')
    await fs.writeFile(path.join(root, 'external.css'), '#reading { width: 29px; }')
    await fs.writeFile(path.join(root, 'setup.js'), `window.fixtureReady = (async () => {
      const mode = new URLSearchParams(location.search).get('mode');
      const id = 'odk.tile.css-fixture';
      window.refuseCleanup = mode === 'cleanup-failure';
      const original = { id, kind: 'tile', manifest: { schemaVersion: 1, version: '1.0.0' },
        ...(mode === 'no-css' ? {} : { css: mode === 'missing' ? 'missing.css' : 'default.css' }),
        mount(el) { window.defaultMountWidth = getComputedStyle(el).width;
          if (mode === 'mount-failure') throw Error('Controlled default failure'); el.textContent = '24.5 °C' } };
      window.odkPlugins.register(original);
      const external = { id, kind: 'tile', manifest: { schemaVersion: 1, version: '2.0.0', css: 'external.css' }, css: 'external.css',
        mount(el) { el.textContent = '24.5 °C' }, unmount() { if (window.refuseCleanup) throw Error('Controlled retained external cleanup') } };
      window.odkPlugins.prepareDevelopmentStylesheet(external, new URL('external.css', location.href).href);
      await window.odkPlugins.start({ replacements: [external] });
      const element = document.createElement('div'); element.id = 'reading'; document.body.append(element);
      window.fixtureElement = element;
      window.odkPlugins.activate(window.odkPlugins.get(id), element, { onTick() { return () => {} } });
      const link = document.querySelector('link[data-plugin="' + id + '"]');
      if (!link.sheet) await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject });
    })();`)
    const operation = execute(require('electron'), isolatedElectronArgs([`--user-data-dir=${root}`, path.join(__dirname, 'renderer-css-recovery-electron.cjs')]),
      { env, signal: t.signal, timeout: 30000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 })
    const closed = new Promise(resolve => operation.child.once('close', resolve))
    try {
      const result = await operation
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').pop()), {
        ok: true, modes: ['success', 'missing', 'mount-failure', 'cleanup-failure', 'no-css'], hidden: true, stylesheetMeasured: true,
      })
    } finally { await closed }
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
