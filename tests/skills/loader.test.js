import { jest } from '@jest/globals';
import { SkillLoader } from '../../skills/loader.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const skillsPath = join(__dirname, '..', '..', 'skills');

describe('SkillLoader', () => {
  let loader;

  beforeEach(() => {
    loader = new SkillLoader([skillsPath]);
  });

  test('loadAll finds skills with SKILL.md', async () => {
    const skills = await loader.loadAll();
    expect(skills.length).toBeGreaterThanOrEqual(1);
  });

  test('loads system skill as prompt mode', async () => {
    const skills = await loader.loadAll();
    const sys = skills.find(s => s.name === 'system');
    expect(sys).toBeDefined();
    expect(sys.mode).toBe('prompt');
    expect(sys.handler).toBeUndefined();
    expect(sys.promptBody).toBeDefined();
  });

  test('system skill has trigger keywords', async () => {
    const skills = await loader.loadAll();
    const sys = skills.find(s => s.name === 'system');
    expect(sys.triggers).toContain('status');
    expect(sys.triggers).toContain('uptime');
  });

  test('matchSkill returns matching skill', async () => {
    await loader.loadAll();
    const match = loader.matchSkill('check system status');
    expect(match).toBeDefined();
    expect(match.name).toBe('system');
  });

  test('matchSkill returns null for no match', async () => {
    await loader.loadAll();
    const match = loader.matchSkill('tell me a joke about cats');
    expect(match).toBeNull();
  });
});
