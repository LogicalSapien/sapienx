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
    expect(skills.length).toBeGreaterThanOrEqual(2);
  });

  test('loads VPS skill as handler mode', async () => {
    const skills = await loader.loadAll();
    const vps = skills.find(s => s.name === 'vps');
    expect(vps).toBeDefined();
    expect(vps.mode).toBe('handler');
    expect(vps.handler).toBeDefined();
    expect(typeof vps.handler).toBe('function');
  });

  test('loads system skill as prompt mode', async () => {
    const skills = await loader.loadAll();
    const sys = skills.find(s => s.name === 'system');
    expect(sys).toBeDefined();
    expect(sys.mode).toBe('prompt');
    expect(sys.handler).toBeUndefined();
    expect(sys.promptBody).toBeDefined();
  });

  test('VPS skill has trigger keywords', async () => {
    const skills = await loader.loadAll();
    const vps = skills.find(s => s.name === 'vps');
    expect(vps.triggers).toContain('shell');
    expect(vps.triggers).toContain('vps');
  });

  test('matchSkill returns first matching skill', async () => {
    await loader.loadAll();
    const match = loader.matchSkill('run a shell command');
    expect(match).toBeDefined();
    expect(match.name).toBe('vps');
  });

  test('matchSkill returns null for no match', async () => {
    await loader.loadAll();
    const match = loader.matchSkill('tell me a joke about cats');
    expect(match).toBeNull();
  });
});
