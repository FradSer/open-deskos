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

test('widget workflow references every inherited upstream interface skill as a flat reference', () => {
  const feature = fs.readFileSync(FEATURE, 'utf8')
  const skill = fs.readFileSync(SKILL, 'utf8')
  const implementation = section(skill, '## 6. Interface-quality workflow')
  const review = section(skill, '## 7. Post-creation interface review')

  assert.match(feature, /inherited as flat widget reference documents/)
  assert.match(feature, /without an upstream skill directory/)
  assert.match(feature, /upstream sub-reference is flattened alongside its entry document/)
  assert.match(feature, /does not use change review or interface review as an implementation-phase or deployment gate/)
  assert.match(feature, /runs after required verification without blocking deployment/)
  assert.match(implementation, /Read every linked reference in its assigned phase/)
  assert.match(implementation, /Read the linked supporting documents before applying their parent guidance/)
  assert.match(implementation, /implementation is complete and may enter the deployment procedure in section 10/)
  assert.doesNotMatch(implementation, /references\/interface-review\.md/)
  assert.doesNotMatch(implementation, /references\/better-interface\.md/)
  assert.match(review, /Run this separate review only after the widget implementation and its required verification are complete/)
  assert.match(review, /Classify introduced regressions separately from pre-existing findings/)
  assert.match(review, /The review reports quality; it does not reopen implementation or block deployment/)
  assert.match(skill, /Prefer a CDP geometry probe \(see section 8\)/)
  assert.doesNotMatch(skill, /jakubkrehel-skills/)
  assert.equal(fs.existsSync(path.join(REFERENCES, 'jakubkrehel-skills')), false)

  for (const reference of [...IMPLEMENTATION_REFERENCES, ...REVIEW_REFERENCES]) {
    assert.equal(fs.existsSync(path.join(REFERENCES, `${reference}.md`)), true, `missing ${reference}`)
    assert.match(skill, new RegExp(`references/${reference}\\.md`))
  }
})
