import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const runtimeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(runtimeRoot, 'src/renderer/themes/liquid-glass-sdk-entry.mjs')],
  bundle: true,
  outfile: path.join(runtimeRoot, 'src/renderer/themes/liquid-glass-sdk.js'),
  platform: 'browser',
  format: 'iife',
  globalName: 'odkLiquidGlassSdk',
  target: 'chrome120',
  minify: true,
  legalComments: 'eof',
})
