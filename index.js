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

  // 11. Claude auth health monitor
  if (daemonMode) {
    const credPath = join(process.env.HOME || '/root', '.claude', '.credentials.json');
    let lastWarnedExpired = false;

    const checkAuth = () => {
      try {
        const creds = JSON.parse(readFileSync(credPath, 'utf-8'));
        const expiresAt = creds?.claudeAiOauth?.expiresAt;
        if (!expiresAt) return;

        const now = Date.now();
        const minsLeft = Math.round((expiresAt - now) / 60000);

        if (expiresAt < now && !lastWarnedExpired) {
          // Access token expired — check if refresh worked by rechecking after a delay
          setTimeout(() => {
            try {
              const fresh = JSON.parse(readFileSync(credPath, 'utf-8'));
              if (fresh.claudeAiOauth.expiresAt <= now) {
                // Still expired — refresh token is dead
                console.error('[Auth] Claude token expired and refresh failed! Login needed.');
                bus.emit('message:outgoing', {
                  id: 'auth-alert',
                  channel: 'whatsapp',
                  to: config.owner.phone ? `${config.owner.phone}@c.us` : null,
                  text: '⚠️ Claude CLI auth expired and refresh failed. SSH in and run: claude login',
                  timestamp: Date.now(),
                  metadata: {}
                });
                lastWarnedExpired = true;
              }
            } catch {}
          }, 60000); // Wait 1 min for auto-refresh
        } else if (expiresAt > now) {
          lastWarnedExpired = false;
        }
      } catch {}
    };

    // Check every 5 minutes
    setInterval(checkAuth, 5 * 60 * 1000);
    checkAuth();
  }

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
