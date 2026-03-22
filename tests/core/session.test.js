import { jest } from '@jest/globals';
import { SessionManager } from '../../core/session.js';
import { createBus } from '../../core/bus.js';

describe('SessionManager', () => {
  let bus, sm;

  beforeEach(() => {
    bus = createBus();
    sm = new SessionManager(bus, {
      inactivityTimeout: 1000,
      maxPinnedSessions: 5,
      summaryOnExpiry: false,
      messageBufferSize: 10
    });
  });

  test('resolveSession creates a new session if none exists', () => {
    const session = sm.resolveSession('whatsapp', 'owner');
    expect(session.sessionId).toBeDefined();
    expect(session.channel).toBe('whatsapp');
    expect(session.pinned).toBe(false);
  });

  test('resolveSession returns same session within timeout', () => {
    const s1 = sm.resolveSession('whatsapp', 'owner');
    const s2 = sm.resolveSession('whatsapp', 'owner');
    expect(s1.sessionId).toBe(s2.sessionId);
  });

  test('resolveSession creates new session after timeout', async () => {
    const s1 = sm.resolveSession('whatsapp', 'owner');
    await new Promise(r => setTimeout(r, 1100));
    const s2 = sm.resolveSession('whatsapp', 'owner');
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  test('pinSession creates a named pinned session', () => {
    const session = sm.pinSession('whatsapp', 'owner', 'my-project');
    expect(session.pinned).toBe(true);
    expect(session.topic).toBe('my-project');
  });

  test('pinned sessions do not expire', async () => {
    const s1 = sm.pinSession('whatsapp', 'owner', 'my-project');
    await new Promise(r => setTimeout(r, 1100));
    const s2 = sm.resolveSession('whatsapp', 'owner');
    expect(s1.sessionId).toBe(s2.sessionId);
  });

  test('unpinSession returns to rolling session', () => {
    sm.pinSession('whatsapp', 'owner', 'my-project');
    sm.unpinSession('whatsapp', 'owner');
    const session = sm.resolveSession('whatsapp', 'owner');
    expect(session.pinned).toBe(false);
  });

  test('forceNewSession creates new session immediately', () => {
    const s1 = sm.resolveSession('whatsapp', 'owner');
    const s2 = sm.forceNewSession('whatsapp', 'owner');
    expect(s1.sessionId).not.toBe(s2.sessionId);
  });

  test('listSessions returns all active sessions', () => {
    sm.resolveSession('whatsapp', 'owner');
    sm.resolveSession('tui', 'owner');
    const sessions = sm.listSessions();
    expect(sessions.length).toBe(2);
  });

  test('setOverride stores cli/model override on session', () => {
    sm.resolveSession('whatsapp', 'owner');
    sm.setOverride('whatsapp', 'owner', 'cli', 'codex');
    const session = sm.resolveSession('whatsapp', 'owner');
    expect(session.cliOverride).toBe('codex');
  });

  test('bufferMessage stores messages for summarization', () => {
    sm.resolveSession('whatsapp', 'owner');
    sm.bufferMessage('whatsapp', 'owner', 'hello');
    sm.bufferMessage('whatsapp', 'owner', 'world');
    const buf = sm.getMessageBuffer('whatsapp', 'owner');
    expect(buf).toEqual(['hello', 'world']);
  });

  test('logs session history as JSONL on expiry', async () => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sapienx-test-'));
    sm.enableHistory(tmpDir);

    sm.resolveSession('whatsapp', 'owner');
    sm.bufferMessage('whatsapp', 'owner', 'test message');
    await new Promise(r => setTimeout(r, 1100));
    sm.resolveSession('whatsapp', 'owner');

    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith('.jsonl'));
    expect(files.length).toBe(1);
    const content = fs.readFileSync(path.join(tmpDir, files[0]), 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.sessionId).toBeDefined();
    expect(entry.channel).toBe('whatsapp');
    expect(entry.messageCount).toBe(1);

    fs.rmSync(tmpDir, { recursive: true });
  });
});
