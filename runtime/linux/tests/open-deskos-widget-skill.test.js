const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..')
const SKILL_ROOT = path.join(REPOSITORY_ROOT, '.agents', 'skills', 'open-deskos-widget')
const SKILL = path.join(SKILL_ROOT, 'SKILL.md')
const FEATURE = path.join(__dirname, 'features', 'open-deskos-widget-skill.feature')
const REFERENCES = path.join(SKILL_ROOT, 'references')
const REQUIRED_REFERENCES = [
  'better-accessibility',
  'better-colors',
  'better-interface',
  'better-layout',
  'better-typography',
  'better-ui',
  'better-writing',
  'break',
  'explain-interface',
  'interface-review',
  'variant',
]

test('widget workflow references every inherited upstream interface skill as a flat reference', () => {
  const feature = fs.readFileSync(FEATURE, 'utf8')
  const skill = fs.readFileSync(SKILL, 'utf8')

  assert.match(feature, /inherited as flat widget reference documents/)
  assert.match(feature, /without an upstream skill directory/)
  assert.match(feature, /upstream sub-reference is flattened alongside its entry document/)
  assert.match(skill, /## 6\. Interface-quality workflow/)
  assert.match(skill, /Read every linked reference in its assigned phase/)
  assert.match(skill, /only then begin the deployment procedure in section 9/)
  assert.match(skill, /Prefer a CDP geometry probe \(see section 7\)/)
  assert.doesNotMatch(skill, /jakubkrehel-skills/)
  assert.equal(fs.existsSync(path.join(REFERENCES, 'jakubkrehel-skills')), false)

  for (const reference of REQUIRED_REFERENCES) {
    assert.equal(fs.existsSync(path.join(REFERENCES, `${reference}.md`)), true, `missing ${reference}`)
    assert.match(skill, new RegExp(`references/${reference}\\.md`))
  }
})
