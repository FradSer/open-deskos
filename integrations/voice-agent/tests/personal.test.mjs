import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, readFile, stat, chmod, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPersonalConfig } from '../src/personal-config.mjs';
import { createMemoryStore } from '../src/memory.mjs';
import { createPersonalTools } from '../src/personal-tools.mjs';

async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'personal-test-')));
  t.after(async () => { const { rm } = await import('node:fs/promises'); await rm(dir, { recursive: true, force: true }); });
  return dir;
}

test('Given absent config When loading Then coding compatibility', async () => {
  assert.deepEqual(await loadPersonalConfig({}), { profile: 'coding', skillPaths: [] });
});

test('Given personal config When validating Then strict safe local files only', async (t) => {
  const dir = await fixture(t);
  const path = join(dir, 'config.json');
  const skill = join(dir, 'SKILL.md');
  await writeFile(skill, '---\nname: reviewed\ndescription: Reviewed skill\n---\nInstructions');
  const config = { profile: 'personal', skillPaths: [skill], memoryFile: join(dir, 'private', 'MEMORY.json'), didi: { environment: 'sandbox', keyFile: join(dir, 'key') } };
  await writeFile(path, JSON.stringify(config));
  assert.deepEqual(await loadPersonalConfig({ ODESK_VOICE_AGENT_CONFIG: path }), config);
  for (const bad of [{ ...config, unexpected: 'DO_NOT_REFLECT' }, { ...config, memoryFile: './relative' }, { ...config, didi: { environment: 'other', keyFile: '/key' } }, { ...config, skillPaths: [dir] }]) {
    await writeFile(path, JSON.stringify(bad));
    await assert.rejects(loadPersonalConfig({ ODESK_VOICE_AGENT_CONFIG: path }), (e) => !e.message.includes('DO_NOT_REFLECT'));
  }
  await writeFile(path, '{DO_NOT_REFLECT');
  await assert.rejects(loadPersonalConfig({ ODESK_VOICE_AGENT_CONFIG: path }), /Invalid personal assistant configuration/);
});

test('Given memory When explicit remember/forget Then exact single-use current-turn grants and private persistence', async (t) => {
  const dir = await fixture(t);
  const file = join(dir, 'private', 'MEMORY.json');
  const memory = createMemoryStore(file);
  assert.equal(await memory.read(), '{}');
  await assert.rejects(memory.update({ category: 'note', value: 'tea' }), /current user turn/);
  memory.beginTurn('记住：我喜欢茶');
  await assert.rejects(memory.update({ category: 'note', value: 'coffee' }), /current user turn/);
  await memory.update({ category: 'note', value: '我喜欢茶' });
  assert.deepEqual(JSON.parse(await memory.read()), { note: '我喜欢茶' });
  await assert.rejects(memory.update({ category: 'note', value: '我喜欢茶' }), /current user turn/);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(join(dir, 'private'))).mode & 0o777, 0o700);
  memory.beginTurn('remember beverage: tea');
  await memory.update({ category: 'beverage', value: 'tea' });
  memory.beginTurn('hello');
  await assert.rejects(memory.forget({ category: 'beverage' }), /current user turn/);
  memory.beginTurn('忘记 beverage');
  await memory.forget({ category: 'beverage' });
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { note: '我喜欢茶' });
});

test('Given unsafe memory When reading/writing Then reject oversized insecure linked and secret data', async (t) => {
  const dir = await fixture(t);
  const file = join(dir, 'MEMORY.json');
  const memory = createMemoryStore(file);
  memory.beginTurn('remember: password=example-only');
  await assert.rejects(memory.update({ category: 'note', value: 'password=example-only' }), /sensitive/);
  await writeFile(file, ' '.repeat(16385), { mode: 0o600 });
  await assert.rejects(memory.read(), /memory/i);
  await writeFile(file, '{}');
  await chmod(file, 0o644);
  await assert.rejects(memory.read(), /memory/i);
  const link = join(dir, 'link');
  await symlink(file, link);
  await assert.rejects(createMemoryStore(link).read(), /memory/i);
});

test('Given personal tools When reading skills Then only indexed reviewed files are exposed', async (t) => {
  const dir = await fixture(t);
  const skill = join(dir, 'SKILL.md');
  await writeFile(skill, 'reviewed');
  const tools = createPersonalTools({ memory: createMemoryStore(join(dir, 'MEMORY.json')), skillPaths: [skill] });
  assert.deepEqual(tools.map((tool) => tool.name), ['memory_read', 'memory_update', 'memory_forget', 'skill_read']);
  const tool = tools.at(-1);
  assert.equal((await tool.execute('id', { index: 0 })).content[0].text, 'reviewed');
  await assert.rejects(tool.execute('id', { index: 1 }), /skill/i);
});
