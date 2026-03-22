import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';

export class SkillLoader {
  constructor(paths) {
    this.paths = paths;
    this.skills = [];
  }

  async loadAll() {
    this.skills = [];

    for (const basePath of this.paths) {
      if (!existsSync(basePath)) continue;

      const entries = readdirSync(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = join(basePath, entry.name);
        const skillMdPath = join(skillDir, 'SKILL.md');

        if (!existsSync(skillMdPath)) continue;

        const raw = readFileSync(skillMdPath, 'utf-8');
        const { data: frontmatter, content: body } = matter(raw);

        const skill = {
          name: frontmatter.name || entry.name,
          description: frontmatter.description || '',
          triggers: frontmatter.triggers || [],
          mode: frontmatter.mode || 'prompt',
          ownerOnly: frontmatter.ownerOnly || false,
          env: frontmatter.env || [],
          promptBody: body.trim(),
          dir: skillDir
        };

        // Load handler if exists
        const handlerPath = join(skillDir, 'handler.js');
        if (existsSync(handlerPath)) {
          const mod = await import(handlerPath);
          skill.handler = mod.default || mod.handler;
          skill.mode = 'handler';
        }

        this.skills.push(skill);
      }
    }

    return this.skills;
  }

  matchSkill(text) {
    const lower = text.toLowerCase();
    for (const skill of this.skills) {
      for (const trigger of skill.triggers) {
        if (lower.includes(trigger.toLowerCase())) {
          return skill;
        }
      }
    }
    return null;
  }

  getSkillSummaries() {
    return this.skills.map(s => ({
      name: s.name,
      description: s.description,
      mode: s.mode,
      triggers: s.triggers
    }));
  }
}
