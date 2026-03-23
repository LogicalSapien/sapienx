import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';

// User data/config home — similar to ~/.claude/, ~/.config/openai, etc.
const sapienxHome = process.env.SAPIENX_HOME || join(homedir(), '.sapienx');

// Ensure directory structure exists
function ensureDirs() {
  mkdirSync(join(sapienxHome, 'data', 'session-history'), { recursive: true });
  mkdirSync(join(sapienxHome, 'memory'), { recursive: true });
  mkdirSync(join(sapienxHome, 'data', 'media-tmp'), { recursive: true });
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

  // Identity files
  soul: join(sapienxHome, 'SOUL.md'),
  identity: join(sapienxHome, 'IDENTITY.md'),
  user: join(sapienxHome, 'USER.md'),

  // Persistent memory
  memory: join(sapienxHome, 'memory'),

  // Delivery queue
  deliveryQueue: join(sapienxHome, 'data', 'delivery-queue.json'),
  deliveryDead: join(sapienxHome, 'data', 'delivery-dead.json'),

  // Media
  mediaTmp: join(sapienxHome, 'data', 'media-tmp'),

  ensureDirs
};

export default paths;
