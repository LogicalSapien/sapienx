import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import paths from '../config/paths.js';

const RETRY_DELAYS = [5000, 15000, 45000, 120000, 300000]; // 5s, 15s, 45s, 2m, 5m
const MAX_RETRIES = 5;

export class DeliveryQueue {
  constructor(bus) {
    this.bus = bus;
    this._queue = [];
    this._channels = {};
    this._processing = false;
    this._timers = new Map();

    // Load persisted queue
    this._load();

    // Intercept outgoing messages
    this.bus.on('message:outgoing', (msg) => this.enqueue(msg));
  }

  registerChannel(name, channel) {
    this._channels[name] = channel;
    // Process any queued messages for this channel
    this._processQueue();
  }

  enqueue(message) {
    const entry = {
      id: message.id || uuidv4(),
      message,
      attempts: 0,
      createdAt: Date.now(),
      nextRetryAt: Date.now()
    };
    this._queue.push(entry);
    this._persist();
    this._processQueue();
  }

  async _processQueue() {
    if (this._processing) return;
    this._processing = true;

    while (this._queue.length > 0) {
      const now = Date.now();
      const entry = this._queue.find(e => e.nextRetryAt <= now);
      if (!entry) break;

      const channel = this._channels[entry.message.channel];
      if (!channel || !channel.isConnected?.()) {
        // Channel not ready — will retry on next cycle
        entry.nextRetryAt = now + 5000;
        break;
      }

      try {
        await channel.send(entry.message);
        // Success — remove from queue
        this._queue = this._queue.filter(e => e.id !== entry.id);
        this._persist();
        this.bus.emit('message:delivered', entry.message);
      } catch (err) {
        entry.attempts++;
        console.error(`[DeliveryQueue] Failed to send (attempt ${entry.attempts}/${MAX_RETRIES}): ${err.message}`);

        if (entry.attempts >= MAX_RETRIES) {
          // Move to dead letter
          console.error(`[DeliveryQueue] Max retries reached for ${entry.id} — moving to dead letter`);
          this._queue = this._queue.filter(e => e.id !== entry.id);
          this._appendDead(entry);
          this._persist();
        } else {
          // Schedule retry with exponential backoff
          const delay = RETRY_DELAYS[Math.min(entry.attempts - 1, RETRY_DELAYS.length - 1)];
          entry.nextRetryAt = now + delay;
          this._persist();

          // Schedule a wake-up for the retry
          const timer = setTimeout(() => {
            this._timers.delete(entry.id);
            this._processQueue();
          }, delay);
          this._timers.set(entry.id, timer);
        }
      }
    }

    this._processing = false;
  }

  _persist() {
    try {
      const data = this._queue.map(e => ({
        id: e.id,
        message: { ...e.message, metadata: { ...e.message.metadata, rawMsg: undefined } },
        attempts: e.attempts,
        createdAt: e.createdAt,
        nextRetryAt: e.nextRetryAt
      }));
      writeFileSync(paths.deliveryQueue, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error(`[DeliveryQueue] Persist failed: ${err.message}`);
    }
  }

  _load() {
    if (!existsSync(paths.deliveryQueue)) return;
    try {
      const data = JSON.parse(readFileSync(paths.deliveryQueue, 'utf-8'));
      this._queue = data.map(e => ({
        ...e,
        nextRetryAt: Date.now() // Retry immediately on restart
      }));
      if (this._queue.length > 0) {
        console.log(`[DeliveryQueue] Loaded ${this._queue.length} pending message(s)`);
      }
    } catch {}
  }

  _appendDead(entry) {
    try {
      let dead = [];
      if (existsSync(paths.deliveryDead)) {
        dead = JSON.parse(readFileSync(paths.deliveryDead, 'utf-8'));
      }
      dead.push({
        ...entry,
        message: { ...entry.message, metadata: { ...entry.message.metadata, rawMsg: undefined } },
        failedAt: Date.now()
      });
      // Keep last 100 dead entries
      if (dead.length > 100) dead = dead.slice(-100);
      writeFileSync(paths.deliveryDead, JSON.stringify(dead, null, 2));
    } catch {}
  }

  stopAll() {
    for (const [, timer] of this._timers) clearTimeout(timer);
    this._timers.clear();
  }
}
