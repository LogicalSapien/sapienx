import paths from './config/paths.js';
import config from './config/sapienx.config.js';
import { createBus } from './core/bus.js';
import { SessionManager } from './core/session.js';
import { Gateway } from './core/gateway.js';
import { Agent } from './core/agent.js';
import { Scheduler } from './core/scheduler.js';
import { SkillLoader } from './skills/loader.js';
import { ClaudeAdapter } from './cli-adapters/claude.js';
import { TuiChannel } from './channels/tui.js';
import { DeliveryQueue } from './core/delivery-queue.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure ~/.sapienx/ directory structure exists
paths.ensureDirs();
const tuiOnly = process.argv.includes('--tui-only');
const daemonMode = process.argv.includes('--daemon');

async function main() {
  console.log('Starting SapienX...');

  // 1. Create event bus
  const bus = createBus();

  // 2. Session manager
  const sessionManager = new SessionManager(bus, config.sessions);
  sessionManager.enablePersistence(paths.sessions);

  // 3. Session history
  sessionManager.enableHistory(paths.sessionHistory);

  // 4. Skill loader
  const skillPaths = config.skills.paths.map(p =>
    p.startsWith('.') ? join(__dirname, p) : p
  );
  const skillLoader = new SkillLoader(skillPaths);
  const skills = await skillLoader.loadAll();
  console.log(`Loaded ${skills.length} skill(s): ${skills.map(s => s.name).join(', ')}`);

  // 5. CLI adapters — register all configured adapters
  const cliAdapters = {};
  const adapterClasses = { claude: ClaudeAdapter };

  // Dynamically load optional adapters
  try {
    const { CodexAdapter } = await import('./cli-adapters/codex.js');
    adapterClasses.codex = CodexAdapter;
  } catch {}

  for (const [name, adapterConfig] of Object.entries(config.cli.adapters)) {
    const AdapterClass = adapterClasses[name];
    if (!AdapterClass) continue;
    const adapter = new AdapterClass(adapterConfig);
    if (adapter.isAvailable()) {
      cliAdapters[name] = adapter;
      console.log(`${name} CLI adapter: ready`);
    } else {
      console.log(`${name} CLI adapter: not installed (skipping)`);
    }
  }

  // 6. Gateway
  const gateway = new Gateway(bus, config);

  // 6.5. Delivery queue (intercepts message:outgoing, retries on failure)
  const deliveryQueue = new DeliveryQueue(bus);

  // 7. Scheduler
  const scheduler = new Scheduler(bus, config.scheduler);

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
    deliveryQueue.registerChannel('tui', tui);
  }

  if (!tuiOnly && config.channels.whatsapp.enabled) {
    try {
      const { WhatsAppChannel } = await import('./channels/whatsapp.js');
      const wa = new WhatsAppChannel(bus, config.channels.whatsapp);
      await wa.start();
      channels.push(wa);
      deliveryQueue.registerChannel('whatsapp', wa);
    } catch (err) {
      console.error('Failed to start WhatsApp:', err.message);
    }
  }

  // 10. Outbox watcher — picks up messages from `sapienx message` CLI
  const outboxDir = join(paths.data, 'outbox');
  const { mkdirSync: mkdirS, readdirSync, unlinkSync } = await import('node:fs');
  mkdirS(outboxDir, { recursive: true });

  const pollOutbox = () => {
    try {
      const files = readdirSync(outboxDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const filePath = join(outboxDir, file);
          const msg = JSON.parse(readFileSync(filePath, 'utf-8'));
          bus.emit('message:outgoing', msg);
          unlinkSync(filePath);
          console.log(`[Outbox] Sent queued message: ${msg.id}`);
        } catch (err) {
          console.error(`[Outbox] Failed to process ${file}: ${err.message}`);
        }
      }
    } catch {}
  };

  // Poll every 2 seconds
  const outboxTimer = setInterval(pollOutbox, 2000);
  pollOutbox(); // Check immediately

  // 10.5. Periodic media temp cleanup (every 30 minutes, files older than 1 hour)
  const { Transcriber } = await import('./core/transcriber.js');
  const mediaCleaner = new Transcriber();
  const mediaCleanupTimer = setInterval(() => mediaCleaner.cleanupOldMedia(), 30 * 60 * 1000);

  // 11. Graceful shutdown
  const shutdown = async () => {
    console.log('\nShutting down SapienX...');
    clearInterval(outboxTimer);
    clearInterval(mediaCleanupTimer);
    scheduler.stopAll();
    deliveryQueue.stopAll();
    for (const ch of channels) await ch.stop();
    sessionManager.destroy();
    process.exit(0);
  };

  bus.on('shutdown', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Emit startup complete — channels handle displaying this
  if (!tuiOnly) {
    console.log('SapienX is running.');
  }
}

// Handle unhandled rejections from whatsapp-web.js internals
// (e.g., puppeteer execution context destroyed during QR scan navigation)
process.on('unhandledRejection', (err) => {
  const msg = err?.message || String(err);
  if (msg.includes('Execution context was destroyed') || msg.includes('navigation')) {
    console.log('[WhatsApp] Browser navigated during auth — this is normal. Reconnecting...');
    // Don't crash — whatsapp-web.js will recover on its own
    return;
  }
  console.error('Unhandled rejection:', err);
});

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
