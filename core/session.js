import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, appendFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';

export class SessionManager {
  constructor(bus, config) {
    this.bus = bus;
    this.config = config;
    this.sessions = {};
    this.messageBuffers = {};
    this._flushTimer = null;
    this._persistPath = null;
    this._historyDir = null;
  }

  _key(channel, from) {
    return `${channel}-${from}`;
  }

  _generateSessionId(channel) {
    const date = new Date().toISOString().slice(0, 10);
    const short = uuidv4().slice(0, 6);
    return `${channel}-${date}-${short}`;
  }

  _isExpired(session) {
    if (session.pinned) return false;
    return Date.now() - session.lastActive > this.config.inactivityTimeout;
  }

  resolveSession(channel, from) {
    const key = this._key(channel, from);
    const existing = this.sessions[key];

    if (existing && !this._isExpired(existing)) {
      existing.lastActive = Date.now();
      this._schedulePersist();
      return existing;
    }

    if (existing) {
      this._expireSession(key, existing);
    }

    return this._createSession(key, channel, from);
  }

  _createSession(key, channel, from) {
    const session = {
      sessionId: this._generateSessionId(channel),
      channel,
      from,
      lastActive: Date.now(),
      startedAt: Date.now(),
      pinned: false,
      topic: null,
      cliOverride: null,
      modelOverride: null,
      messageCount: 0
    };
    this.sessions[key] = session;
    this.messageBuffers[key] = [];
    this.bus.emit('session:created', session);
    this._schedulePersist();
    return session;
  }

  _expireSession(key, session) {
    const summary = this._getSummaryFromBuffer(key);
    this._logSessionHistory(session, summary);
    this.bus.emit('session:expired', { ...session, summary });
    delete this.messageBuffers[key];
  }

  _getSummaryFromBuffer(key) {
    const buf = this.messageBuffers[key];
    if (!buf || buf.length === 0) return null;
    return buf.slice(-3).join(' | ');
  }

  _logSessionHistory(session, summary) {
    if (!this._historyDir) return;
    const now = new Date();
    const filename = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}.jsonl`;
    const filePath = join(this._historyDir, filename);
    const entry = JSON.stringify({
      sessionId: session.sessionId,
      channel: session.channel,
      started: new Date(session.startedAt).toISOString(),
      ended: now.toISOString(),
      topic: summary || session.topic || null,
      messageCount: session.messageCount || 0
    });
    if (!existsSync(this._historyDir)) mkdirSync(this._historyDir, { recursive: true });
    appendFileSync(filePath, entry + '\n');
  }

  enableHistory(historyDir) {
    this._historyDir = historyDir;
    this._cleanupOldHistory();
  }

  _cleanupOldHistory() {
    if (!this._historyDir || !existsSync(this._historyDir)) return;
    const retentionMonths = this.config.retentionMonths || 6;
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), now.getMonth() - retentionMonths, 1);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
    const files = readdirSync(this._historyDir).filter(f => f.endsWith('.jsonl'));
    for (const file of files) {
      const fileMonth = file.replace('.jsonl', '');
      if (fileMonth < cutoffStr) {
        unlinkSync(join(this._historyDir, file));
      }
    }
  }

  pinSession(channel, from, name) {
    const key = this._key(channel, from);
    const existing = this.sessions[key];

    if (existing && existing.pinned && existing.topic === name) {
      existing.lastActive = Date.now();
      return existing;
    }

    const session = {
      sessionId: `${channel}-${name}`,
      channel,
      from,
      lastActive: Date.now(),
      startedAt: Date.now(),
      pinned: true,
      topic: name,
      cliOverride: null,
      modelOverride: null,
      messageCount: 0
    };
    this.sessions[key] = session;
    this.messageBuffers[key] = [];
    this.bus.emit('session:created', session);
    this._schedulePersist();
    return session;
  }

  unpinSession(channel, from) {
    const key = this._key(channel, from);
    const existing = this.sessions[key];
    if (existing) {
      this._expireSession(key, existing);
    }
    delete this.sessions[key];
    this._schedulePersist();
  }

  forceNewSession(channel, from) {
    const key = this._key(channel, from);
    const existing = this.sessions[key];
    if (existing) {
      this._expireSession(key, existing);
    }
    return this._createSession(key, channel, from);
  }

  listSessions() {
    return Object.values(this.sessions);
  }

  setOverride(channel, from, type, value) {
    const key = this._key(channel, from);
    const session = this.sessions[key];
    if (!session) return;
    if (type === 'cli') session.cliOverride = value;
    if (type === 'model') session.modelOverride = value;
    this._schedulePersist();
  }

  bufferMessage(channel, from, text) {
    const key = this._key(channel, from);
    if (!this.messageBuffers[key]) this.messageBuffers[key] = [];
    this.messageBuffers[key].push(text);
    if (this.messageBuffers[key].length > this.config.messageBufferSize) {
      this.messageBuffers[key].shift();
    }
    const session = this.sessions[key];
    if (session) session.messageCount++;
  }

  getMessageBuffer(channel, from) {
    return this.messageBuffers[this._key(channel, from)] || [];
  }

  getLastSummary(channel, from) {
    const key = this._key(channel, from);
    return this._lastSummaries?.[key] || null;
  }

  enablePersistence(filePath) {
    this._persistPath = filePath;
    this._loadFromDisk();
  }

  _schedulePersist() {
    if (!this._persistPath) return;
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this._flushToDisk(), 1000);
  }

  _flushToDisk() {
    if (!this._persistPath) return;
    const dir = dirname(this._persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = this._persistPath + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.sessions, null, 2));
    renameSync(tmp, this._persistPath);
  }

  _loadFromDisk() {
    if (!this._persistPath || !existsSync(this._persistPath)) return;
    try {
      const data = readFileSync(this._persistPath, 'utf-8');
      this.sessions = JSON.parse(data);
    } catch {
      this.sessions = {};
    }
  }

  destroy() {
    if (this._flushTimer) clearTimeout(this._flushTimer);
    if (this._persistPath) this._flushToDisk();
  }
}
