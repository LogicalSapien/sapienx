import { jest } from '@jest/globals';
import { Agent } from '../../core/agent.js';
import { createBus } from '../../core/bus.js';
import { SessionManager } from '../../core/session.js';
import { SkillLoader } from '../../skills/loader.js';
import { Gateway } from '../../core/gateway.js';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Agent', () => {
  let bus, agent, sessionManager, skillLoader, gateway, mockAdapter;
  const config = {
    owner: { phone: '628123' },
    channels: { tui: { enabled: true, cli: 'claude', model: null } },
    groups: {},
    cli: {
      default: 'claude',
      maxConcurrent: 2,
      adapters: { claude: { model: 'sonnet', autoModel: false, maxTurns: 5 } }
    },
    skills: { paths: [join(__dirname, '..', '..', 'skills')] }
  };

  beforeEach(async () => {
    bus = createBus();
    sessionManager = new SessionManager(bus, {
      inactivityTimeout: 300000,
      maxPinnedSessions: 5,
      summaryOnExpiry: false,
      messageBufferSize: 10
    });
    skillLoader = new SkillLoader(config.skills.paths);
    await skillLoader.loadAll();
    gateway = new Gateway(bus, config);
    mockAdapter = {
      invoke: jest.fn().mockResolvedValue('AI response'),
      isAvailable: () => true
    };
    agent = new Agent(bus, config, {
      sessionManager,
      skillLoader,
      cliAdapters: { claude: mockAdapter },
      gateway,
      scheduler: null
    });
  });

  function sendMessage(text) {
    return new Promise((resolve) => {
      bus.once('message:outgoing', (msg) => resolve(msg));
      bus.emit('message:routed', {
        id: '1', channel: 'tui', from: 'tui',
        text, timestamp: Date.now(), metadata: {}
      });
    });
  }

  test('/help returns command list', async () => {
    const reply = await sendMessage('/help');
    expect(reply.text).toContain('/new');
    expect(reply.text).toContain('/status');
  });

  test('/status returns system info', async () => {
    const reply = await sendMessage('/status');
    expect(reply.text).toContain('Uptime');
    expect(reply.text).toContain('Memory');
  });

  test('/new creates a fresh session', async () => {
    const reply = await sendMessage('/new');
    expect(reply.text).toContain('New session');
  });

  test('/session pin creates pinned session', async () => {
    const reply = await sendMessage('/session test-project');
    expect(reply.text).toContain('Pinned session: test-project');
  });

  test('/cli switches adapter', async () => {
    const reply = await sendMessage('/cli codex');
    expect(reply.text).toContain('CLI switched to: codex');
  });

  test('/model switches model', async () => {
    const reply = await sendMessage('/model opus');
    expect(reply.text).toContain('Model switched to: opus');
  });

  test('non-command message invokes CLI adapter', async () => {
    const reply = await sendMessage('hello world');
    expect(mockAdapter.invoke).toHaveBeenCalled();
    expect(reply.text).toBe('AI response');
  });

  test('skill trigger routes to skill handler', async () => {
    const reply = await sendMessage('/vps echo hello');
    // VPS handler runs the command directly
    expect(reply.text).toContain('hello');
  });

  test('resolves model from group config', async () => {
    const groupMsg = {
      id: '1', channel: 'whatsapp', from: '628123',
      text: 'test', timestamp: Date.now(),
      metadata: { isGroup: true, groupId: 'g1' },
      groupConfig: { cli: 'claude', model: 'haiku' }
    };
    const session = sessionManager.resolveSession('whatsapp', '628123');
    const model = agent._resolveModel(session, groupMsg);
    expect(model).toBe('haiku');
  });
});
