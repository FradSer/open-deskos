const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..')
const SKILL_ROOT = path.join(REPOSITORY_ROOT, '.agents', 'skills', 'open-deskos-widget')
const SKILL = path.join(SKILL_ROOT, 'SKILL.md')
const FEATURE = path.join(__dirname, 'features', 'open-deskos-widget-skill.feature')
const REFERENCES = path.join(SKILL_ROOT, 'references')
const IMPLEMENTATION_REFERENCES = [
  'better-accessibility',
  'better-colors',
  'better-layout',
  'better-typography',
  'better-ui',
  'better-writing',
  'break',
  'explain-interface',
  'variant',
]
const REVIEW_REFERENCES = ['better-interface', 'interface-review']

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
  assert.match(skill, /Design and develop Open DeskOS CM5 Widgets and Apps/)
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

  assert.match(feature, /inherited as flat reference documents/)
  assert.match(feature, /without an upstream skill directory/)
  assert.match(feature, /every linked local reference resolves within the skill reference tree/)
  assert.match(feature, /ends at deterministic runtime verification/)
  assert.match(implementation, /Read every linked reference in its assigned phase/)
  assert.match(implementation, /Read linked supporting documents when the selected surface exercises that concern/)
  assert.doesNotMatch(implementation, /references\/interface-review\.md/)
  assert.doesNotMatch(implementation, /references\/better-interface\.md/)
  assert.match(review, /after implementation and required verification are complete/)
  assert.match(review, /Classify introduced regressions separately from pre-existing findings/)
  assert.match(review, /does not commit or deploy/)
  assert.doesNotMatch(skill, /jakubkrehel-skills/)
  assert.equal(fs.existsSync(path.join(REFERENCES, 'jakubkrehel-skills')), false)

  for (const reference of [...IMPLEMENTATION_REFERENCES, ...REVIEW_REFERENCES]) {
    assert.equal(fs.existsSync(path.join(REFERENCES, `${reference}.md`)), true, `missing ${reference}`)
    assert.match(skill, new RegExp(`references/${reference}\\.md`))
  }

  for (const file of markdownFiles(SKILL_ROOT)) assertLocalLinksResolve(file)
})
