import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

// User data/config home — similar to ~/.claude/, ~/.config/openai, etc.
const sapienxHome = process.env.SAPIENX_HOME || join(homedir(), '.sapienx');

// Ensure directory structure exists
function ensureDirs() {
  mkdirSync(join(sapienxHome, 'data', 'session-history'), { recursive: true });
}

const paths = {
  home: sapienxHome,
  env: join(sapienxHome, '.env'),
  data: join(sapienxHome, 'data'),
  sessions: join(sapienxHome, 'data', 'sessions.json'),
  sessionHistory: join(sapienxHome, 'data', 'session-history'),
  schedules: join(sapienxHome, 'data', 'schedules.json'),
  pid: join(sapienxHome, 'data', 'sapienx.pid'),
  log: join(sapienxHome, 'data', 'sapienx.log'),
  migrations: join(sapienxHome, 'data', '.migrations'),
  waAuth: join(sapienxHome, '.wwebjs_auth'),
  ensureDirs
};

export default paths;
