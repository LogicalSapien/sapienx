export class Gateway {
  constructor(bus, config) {
    this.bus = bus;
    this.config = config;
    this.pendingReplies = new Map();
    this._queues = new Map();
    this._processing = new Map();

    this.bus.on('message:incoming', (msg) => this._enqueue(msg));
  }

  _enqueue(msg) {
    const queueKey = `${msg.channel}-${msg.from}`;
    if (!this._queues.has(queueKey)) {
      this._queues.set(queueKey, []);
    }
    this._queues.get(queueKey).push(msg);

    if (!this._processing.get(queueKey)) {
      this._processQueue(queueKey);
    }
  }

  async _processQueue(queueKey) {
    this._processing.set(queueKey, true);
    const queue = this._queues.get(queueKey);

    while (queue && queue.length > 0) {
      const msg = queue.shift();
      await this._route(msg);
    }

    this._processing.set(queueKey, false);
  }

  async _route(msg) {
    // TUI messages always pass through
    if (msg.channel === 'tui') {
      this.bus.emit('message:routed', msg);
      return;
    }

    // Check group messages
    if (msg.metadata?.isGroup) {
      const groupId = msg.metadata.groupId;
      const groupConfig = this.config.groups[groupId];
      if (!groupConfig || !groupConfig.enabled) return;
      this.bus.emit('message:routed', { ...msg, groupConfig });
      return;
    }

    // Normalize phone numbers for comparison (strip + prefix)
    const ownerPhone = (this.config.owner.phone || '').replace(/^\+/, '');
    const senderPhone = (msg.from || '').replace(/^\+/, '');

    // Check pending replies from non-owner (smart task replies)
    if (senderPhone !== ownerPhone) {
      const reply = this._matchPendingReply(msg);
      if (reply) {
        this.bus.emit('task:reply', { taskId: reply.taskId, message: msg });
        this.pendingReplies.delete(reply.taskId);
        return;
      }
      // Drop non-owner, non-reply messages
      return;
    }

    // Owner message — route to agent
    this.bus.emit('message:routed', msg);
  }

  _matchPendingReply(msg) {
    for (const [taskId, entry] of this.pendingReplies) {
      if (
        entry.channel === msg.channel &&
        entry.expectedFrom === msg.from &&
        Date.now() < entry.expiresAt
      ) {
        return { taskId, ...entry };
      }
    }
    return null;
  }

  registerPendingReply({ taskId, channel, expectedFrom, expiresAt }) {
    this.pendingReplies.set(taskId, { channel, expectedFrom, expiresAt });
  }

  removePendingReply(taskId) {
    this.pendingReplies.delete(taskId);
  }

  cleanupExpiredReplies() {
    const now = Date.now();
    for (const [taskId, entry] of this.pendingReplies) {
      if (now >= entry.expiresAt) {
        this.pendingReplies.delete(taskId);
      }
    }
  }
}
