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

  _isAllowedSender(senderPhone) {
    const ownerPhone = (this.config.owner.phone || '').replace(/^\+/, '');
    const normalized = senderPhone.replace(/^\+/, '');

    // Owner always allowed
    if (normalized === ownerPhone) return true;

    // Check allowed numbers list
    const allowed = this.config.owner.allowedNumbers || [];
    return allowed.some(num => num.replace(/^\+/, '') === normalized);
  }

  async _route(msg) {
    // TUI messages always pass through
    if (msg.channel === 'tui') {
      this.bus.emit('message:routed', msg);
      return;
    }

    // Handle group messages based on policy
    if (msg.metadata?.isGroup) {
      const groupId = msg.metadata.groupId;
      const policy = this.config.groupPolicy || 'ignore';
      console.log(`[Gateway] Group: ${groupId} policy=${policy}`);

      if (policy === 'ignore') {
        console.log(`[Gateway] Dropped group message (policy=ignore): ${groupId}`);
        return;
      }

      if (policy === 'allowlist') {
        const groupConfig = this.config.groups?.[groupId];
        const allowedGroups = this.config.allowedGroups || [];
        const isAllowed = (groupConfig && groupConfig.enabled) || allowedGroups.includes(groupId);
        if (!isAllowed) {
          console.log(`[Gateway] Dropped group message (not in allowlist): ${groupId}`);
          return;
        }
        this.bus.emit('message:routed', { ...msg, groupConfig });
        return;
      }

      if (policy === 'all') {
        // Respond in all groups
        this.bus.emit('message:routed', msg);
        return;
      }

      return; // unknown policy = ignore
    }

    // Allow self-chat messages (messaging yourself on WhatsApp)
    if (msg.metadata?.isSelfChat) {
      console.log(`[Gateway] Self-chat message routed`);
      this.bus.emit('message:routed', msg);
      return;
    }

    // Check if sender is allowed (owner or allowlisted number)
    const senderPhone = (msg.from || '').replace(/^\+/, '');
    if (this._isAllowedSender(senderPhone)) {
      console.log(`[Gateway] Allowed sender: ${senderPhone}`);
      this.bus.emit('message:routed', msg);
      return;
    }

    // Check pending replies from non-allowed senders (smart task replies)
    const reply = this._matchPendingReply(msg);
    if (reply) {
      this.bus.emit('task:reply', { taskId: reply.taskId, message: msg });
      this.pendingReplies.delete(reply.taskId);
      return;
    }

    // Drop unrecognized messages
    console.log(`[Gateway] Dropped message from unknown sender: ${senderPhone}`);
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
