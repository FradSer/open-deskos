import { build } from 'esbuild'
import Ajv2020 from 'ajv/dist/2020.js'
import standalone from 'ajv/dist/standalone/index.js'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { renderAvatarDefinition } from '@bible-strong/avatar-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const directory = path.join(root, 'src/renderer/avatars')
const definition = JSON.parse(await readFile(path.join(directory, 'onee.avatar.json'), 'utf8'))
const schema = JSON.parse(await readFile(require.resolve('@bible-strong/avatar-core/schema'), 'utf8'))
// Onee's original Studio geometry uses the engine's 0..2 shape range.
// The published schema incorrectly reuses the 0..1 base roundness range here.
for (const field of ['morphRoundness', 'tipRoundness', 'baseRoundness']) {
  schema.$defs.surface.properties[field] = { type: 'number', minimum: 0, maximum: 2 }
}
const ajv = new Ajv2020({ allErrors: true, strict: true, code: { source: true, esm: true } })
const validate = ajv.compile(schema)
if (!validate(definition)) throw Error(JSON.stringify(validate.errors))
const validator = standalone(ajv, { validate: schema.$id })
await build({
  entryPoints: [path.join(directory, 'onee-sdk-entry.mjs')],
  outfile: path.join(directory, 'onee-sdk.js'),
  bundle: true, platform: 'browser', format: 'iife', globalName: 'odkOneeSdk',
  target: 'chrome120', minify: true, legalComments: 'eof',
  banner: { js: '/*! Bible Strong Avatar Lab / Onee. Stéphane Montlouis-Calixte. AGPL-3.0-only. See avatars/NOTICE.md and LICENSE-AGPL-3.0.txt. */' },
  plugins: [{
    name: 'onee-csp-validator',
    setup(builder) {
      builder.onResolve({ filter: /^ajv\/dist\/2020\.js$/ }, () => ({ path: 'validator', namespace: 'onee-aot' }))
      builder.onLoad({ filter: /.*/, namespace: 'onee-aot' }, () => ({
        contents: `${validator}\nexport default class Ajv { compile() { return validate; } }`,
        loader: 'js', resolveDir: root,
      }))
    },
  }],
})
const scene = renderAvatarDefinition(definition)
const g = scene.geometry, colors = scene.colors
const paths = values => values.map(d => `<path d="${d}" fill="${colors.body}"/>`).join('')
await writeFile(path.join(directory, 'onee.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-150 -150 300 300"><title>Onee</title>${paths(g.backPaths)}<path d="${g.headPath}" fill="${colors.body}"/><path d="${g.leftPath}" fill="${colors.eyes}"/><path d="${g.rightPath}" fill="${colors.eyes}"/>${paths(g.frontPaths)}</svg>\n`)
