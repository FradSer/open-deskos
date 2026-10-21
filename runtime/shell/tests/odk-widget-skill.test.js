const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const RUNTIME_ROOT = path.resolve(__dirname, '..')
const REPOSITORY_ROOT = fs.existsSync(path.join(RUNTIME_ROOT, 'release.json'))
  ? RUNTIME_ROOT
  : path.resolve(RUNTIME_ROOT, '..', '..')
const SKILL_ROOT = path.join(REPOSITORY_ROOT, '.agents', 'skills', 'odk-widget')
const SKILL = path.join(SKILL_ROOT, 'SKILL.md')
const FEATURE = path.join(__dirname, 'features', 'odk-widget-skill.feature')
const REFERENCES = path.join(SKILL_ROOT, 'references')
const IMPLEMENTATION_REFERENCES = ['design', 'verification']
const REVIEW_REFERENCES = ['review']

function section(content, heading) {
  const start = content.indexOf(heading)
  assert.notEqual(start, -1, `missing ${heading}`)
  const next = content.indexOf('\n## ', start + heading.length)
  return content.slice(start, next === -1 ? undefined : next)
}

function markdownFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name)
    return entry.isDirectory() ? markdownFiles(target) : entry.name.endsWith('.md') ? [target] : []
  })
}

function assertLocalLinksResolve(file) {
  const content = fs.readFileSync(file, 'utf8')
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)]+\.md(?:#[^)]+)?)\)/g)) {
    const relative = match[1].split('#')[0]
    const target = path.resolve(path.dirname(file), relative)
    assert.equal(fs.existsSync(target), true, `broken Markdown link in ${path.relative(REPOSITORY_ROOT, file)}: ${match[1]}`)
  }
}

test('skill is scoped to Widget and App design-development with explicit surface routing', () => {
  const feature = fs.readFileSync(FEATURE, 'utf8')
  const skill = fs.readFileSync(SKILL, 'utf8')
  const routing = section(skill, '## 1. Route the surface')
  const workflow = section(skill, '## 4. Design-development workflow')
  const verification = section(skill, '## 5. Verification')

  assert.match(feature, /distinguishes trusted built-in plugins from installable user applications/)
  assert.match(feature, /distinguishes display-only Widgets from interactive Apps/)
  assert.match(feature, /does not include Git commit or CM5 deployment operations/)
  assert.match(skill, /Design and develop Open DeskOS Widgets and Apps in the shared Linux, Windows, and macOS Electron Shell/)
  assert.match(routing, /docs\/AI_PLUGIN_GUIDE\.md/)
  assert.match(routing, /docs\/USER_APPLICATIONS\.md/)
  assert.match(routing, /Widget.*display-only/s)
  assert.match(routing, /App.*interactive/s)
  assert.match(skill, /Built-in plugins use only `DESIGN\.md` semantic `--odk-\*` tokens/)
  assert.match(skill, /Installable packages cannot inherit Shell custom properties/)
  assert.match(skill, /Define local CSS variables from the current `DESIGN\.md` palette inside the package/)
  assert.match(skill, /do not reference unresolved Shell `--odk-\*` properties from the opaque iframe/)
  assert.doesNotMatch(skill, /shared-worktree-git/)
  assert.doesNotMatch(skill, /cm5-stage-release/)
  assert.doesNotMatch(skill, /git-agent commit/)
  assert.match(workflow, /BDD-first/)
  assert.match(verification, /widget-app-styles\.cjs/)
  assert.match(verification, /widget-density\.cjs/)
})

test('Widget and App workflow references every inherited interface discipline', () => {
  const feature = fs.readFileSync(FEATURE, 'utf8')
  const skill = fs.readFileSync(SKILL, 'utf8')
  const implementation = section(skill, '## 4. Design-development workflow')
  const review = section(skill, '## 6. Post-creation interface review')

  assert.match(feature, /covered by consolidated domain guides/)
  assert.match(feature, /without an upstream skill directory/)
  assert.match(feature, /every linked local reference resolves within the skill reference tree/)
  assert.match(feature, /ends at deterministic runtime verification/)
  assert.match(implementation, /Read every linked reference in its assigned phase/)
  assert.match(implementation, /Read linked supporting documents when the selected surface exercises that concern/)
  assert.doesNotMatch(implementation, /references\/review\.md/)
  assert.match(review, /after implementation and required verification are complete/)
  assert.match(review, /Classify introduced regressions separately from pre-existing findings/)
  assert.match(review, /does not commit or deploy/)
  assert.doesNotMatch(skill, /jakubkrehel-skills/)
  assert.equal(fs.existsSync(path.join(REFERENCES, 'jakubkrehel-skills')), false)

  for (const reference of [...IMPLEMENTATION_REFERENCES, ...REVIEW_REFERENCES]) {
    assert.equal(fs.existsSync(path.join(REFERENCES, `${reference}.md`)), true, `missing ${reference}`)
    assert.match(skill, new RegExp(`references/${reference}\\.md`))
  }

  const design = fs.readFileSync(path.join(REFERENCES, 'design.md'), 'utf8')
  const evidence = fs.readFileSync(path.join(REFERENCES, 'verification.md'), 'utf8')
  const reviewGuide = fs.readFileSync(path.join(REFERENCES, 'review.md'), 'utf8')
  for (const domain of ['Information and layout', 'Typography, color, and copy', 'Controls and motion', 'Icons', 'Implementation patterns']) {
    assert.match(design, new RegExp(domain))
  }
  assert.match(design, /accessible names/)
  assert.match(design, /prefers-reduced-motion/)
  assert.match(design, /Pixelarticons/)
  assert.match(design, /Copyright \(c\) 2019 Gerrit Halfmann/)
  assert.match(evidence, /Do not widen tolerance or lower a floor/)
  assert.match(evidence, /In isolated harnesses, do not show foreground windows, steal focus, use production credentials/)
  assert.match(evidence, /fixture pass does not prove live-source recovery or physical input/)
  assert.match(reviewGuide, /read-only by default/)
  assert.match(reviewGuide, /Introduced.*Regression.*Pre-existing/)

  for (const file of markdownFiles(SKILL_ROOT)) assertLocalLinksResolve(file)
})


test('creation workflow retains composition, optional identity, four themes and evidence boundaries', () => {
  const skill = fs.readFileSync(SKILL, 'utf8')
  const design = fs.readFileSync(path.join(REFERENCES, 'design.md'), 'utf8')
  const evidence = fs.readFileSync(path.join(REFERENCES, 'verification.md'), 'utf8')
  const feature = fs.readFileSync(FEATURE, 'utf8')
  assert.match(feature, /Creation preserves the accepted composition and optional headings/)
  assert.match(feature, /Verification separates shared rendering from host acceptance/)
  assert.match(skill, /creation contract/)
  assert.match(section(skill, '## 3. Shape behavior with BDD'), /existing shared Widget harness/)
  assert.match(skill, /normal and replacement paths/)
  assert.match(skill, /title and icon choices per Widget/)
  assert.match(skill, /accessible App name/)
  assert.match(skill, /accepted spans, page order, and the retained Overview/)
  assert.match(skill, /Instrument\/Pixel\/Border Beam\/Liquid Glass/)
  assert.match(design, /source authority, units, freshness/)
  assert.match(design, /top inset; center the reading within the remaining space/)
  assert.match(design, /Remove the unused header slot/)
  assert.match(design, /Do not prefix every heading with an icon/)
  assert.doesNotMatch(design, /plugins\/(?:clock|almanac)\.js/)
  assert.match(evidence, /Session 0 does not prove interactive Session 1 rendering/)
  assert.match(evidence, /native-page-capture\.js/)
  assert.match(evidence, /actual frame/)
  assert.match(evidence, /bounded retries/)
  assert.match(evidence, /Focused repair/)
  assert.match(evidence, /Keep complete-gate failures open/)
})
