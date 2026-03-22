import 'dotenv/config';
import config from './config/sapienx.config.js';
import { createBus } from './core/bus.js';
import { SessionManager } from './core/session.js';
import { Gateway } from './core/gateway.js';
import { Agent } from './core/agent.js';
import { Scheduler } from './core/scheduler.js';
import { SkillLoader } from './skills/loader.js';
import { ClaudeAdapter } from './cli-adapters/claude.js';
import { TuiChannel } from './channels/tui.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tuiOnly = process.argv.includes('--tui-only');
const daemonMode = process.argv.includes('--daemon');

async function main() {
  console.log('Starting SapienX...');

  // 1. Create event bus
  const bus = createBus();

  // 2. Session manager
  const sessionManager = new SessionManager(bus, config.sessions);
  sessionManager.enablePersistence(join(__dirname, 'data', 'sessions.json'));

  // 3. Session history
  sessionManager.enableHistory(join(__dirname, 'data', 'session-history'));

  // 4. Skill loader
  const skillPaths = config.skills.paths.map(p =>
    p.startsWith('.') ? join(__dirname, p) : p
  );
  const skillLoader = new SkillLoader(skillPaths);
  const skills = await skillLoader.loadAll();
  console.log(`Loaded ${skills.length} skill(s): ${skills.map(s => s.name).join(', ')}`);

  // 5. CLI adapters
  const cliAdapters = {};
  const claudeAdapterConfig = config.cli.adapters.claude;
  if (claudeAdapterConfig) {
    const claude = new ClaudeAdapter(claudeAdapterConfig);
    if (claude.isAvailable()) {
      cliAdapters.claude = claude;
      console.log('Claude CLI adapter: ready');
    } else {
      console.warn('Claude CLI not found in PATH. Run: npm install -g @anthropic-ai/claude-code');
    }
  }

  // 6. Gateway
  const gateway = new Gateway(bus, config);

  // 7. Scheduler
  const scheduler = new Scheduler(bus, {
    ...config.scheduler,
    persistPath: config.scheduler.persistPath
      ? join(__dirname, config.scheduler.persistPath.replace('./', ''))
      : null
  });

  // 8. Agent
  const agent = new Agent(bus, config, {
    sessionManager,
    skillLoader,
    cliAdapters,
    gateway,
    scheduler
  });

  // 9. Start channels
  const channels = [];

  if (!daemonMode && (config.channels.tui.enabled || tuiOnly)) {
    const tui = new TuiChannel(bus, config.channels.tui);
    await tui.start();
    channels.push(tui);
  }

  if (!tuiOnly && config.channels.whatsapp.enabled) {
    try {
      const { WhatsAppChannel } = await import('./channels/whatsapp.js');
      const wa = new WhatsAppChannel(bus, config.channels.whatsapp);
      await wa.start();
      channels.push(wa);
    } catch (err) {
      console.error('Failed to start WhatsApp:', err.message);
    }
  }

  // 10. Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down SapienX...');
    scheduler.stopAll();
    for (const ch of channels) await ch.stop();
    sessionManager.destroy();
    process.exit(0);
  };

  bus.on('shutdown', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log('SapienX is running.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
