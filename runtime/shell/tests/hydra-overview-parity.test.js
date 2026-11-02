'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { notPortedOnWindows } = require('./not-ported')
if (notPortedOnWindows(test, 'hydra-host-compiler')) return

test('Overview moisture labels agree with the Hydra firmware classifier', async t => {
  const { homeFactVariables, compileHomeSelection, resolveHomeTemplate } = await import('../../../integrations/personal-agent/src/home-template.mjs')
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'odk-soil-parity-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const input = path.join(directory, 'classify.cpp'), binary = path.join(directory, 'classify')
  await fs.writeFile(input, '#include <cstdio>\n#include "main_node/app/main_display_model.h"\nint main() { for (int n = 0; n <= 200; ++n) std::puts(hydra::soilDisplayStatusLabel(hydra::classifySoil(n / 2.0f))); }\n')
  execFileSync('c++', ['-std=c++17', '-I', path.resolve(__dirname, '../../../peripherals/hydra/src'), input, '-o', binary])
  const firmware = execFileSync(binary, { encoding: 'utf8' }).trim().split('\n')
  assert.equal(firmware.length, 201)
  const now = Date.now()
  for (let n = 0; n <= 200; n++) {
    const soilPercent = n / 2
    const readings = [{ id: 'odk.tile.hydra', label: 'Hydra', state: 'live', value: { plants: [{ id: 1, name: 'Plant 1', soilPercent, online: true, stale: false, soilStale: false, measuredAt: new Date(now).toISOString() }] },
      home: { mode: 'optional', priority: 0, icon: 'plants', fields: ['plants'] } }]
    const facts = homeFactVariables(readings, now)
    const selected = facts.findIndex(fact => fact.factId.endsWith(':plants.0.soilPercent'))
    const output = resolveHomeTemplate(compileHomeSelection({ items: [{ sources: [selected] }] }, facts), readings, now).items[0].text
    assert.match(output, new RegExp(`${firmware[n]} at`, 'i'), `soil ${soilPercent}%`)
  }
})
