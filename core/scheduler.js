import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Scheduler {
  constructor(bus, config) {
    this.bus = bus;
    this.config = config;
    this.tasks = new Map();
    this._cronJobs = new Map();
    this._timers = new Map();
    this._flushTimer = null;

    if (config.persistPath) {
      this._loadFromDisk();
    }
  }

  addReminder({ id, message, channel, to, schedule, delayMs, repeat }) {
    const taskId = id || uuidv4().slice(0, 8);
    const task = {
      id: taskId,
      type: 'reminder',
      message,
      channel,
      to: to || null,
      schedule: schedule || null,
      repeat: repeat || false,
      enabled: true,
      createdAt: new Date().toISOString()
    };

    this.tasks.set(taskId, task);

    if (schedule && cron.validate(schedule)) {
      this._scheduleCron(taskId, schedule, () => {
        this.bus.emit('schedule:reminder', {
          taskId, message, channel, to
        });
      });
    } else if (delayMs) {
      const timer = setTimeout(() => {
        this.bus.emit('schedule:reminder', {
          taskId, message, channel, to
        });
        if (!repeat) this.tasks.delete(taskId);
        this._persist();
      }, delayMs);
      this._timers.set(taskId, timer);
    }

    this._persist();
    return taskId;
  }

  addCron({ id, schedule, command, channel, to }) {
    const taskId = id || uuidv4().slice(0, 8);
    const task = {
      id: taskId,
      type: 'cron',
      schedule,
      command,
      channel,
      to: to || null,
      enabled: true,
      createdAt: new Date().toISOString()
    };

    this.tasks.set(taskId, task);

    if (cron.validate(schedule)) {
      this._scheduleCron(taskId, schedule, () => {
        if (!this.tasks.get(taskId)?.enabled) return;
        this.bus.emit('schedule:cron', {
          taskId, command, channel, to
        });
      });
    }

    this._persist();
    return taskId;
  }

  addSmartTask({ name, schedule, prompt, channel, to, followUp }) {
    const taskId = name;
    const task = {
      id: taskId,
      type: 'smart',
      schedule,
      prompt,
      channel,
      to,
      followUp: followUp || { interval: 600000, maxRetries: 3 },
      enabled: true,
      createdAt: new Date().toISOString()
    };

    this.tasks.set(taskId, task);

    if (schedule && cron.validate(schedule)) {
      this._scheduleCron(taskId, schedule, () => {
        if (!this.tasks.get(taskId)?.enabled) return;
        this.bus.emit('schedule:smart', {
          taskId, prompt, channel, to, followUp: task.followUp
        });
      });
    }

    this._persist();
    return taskId;
  }

  enableTask(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.enabled = true;
      this._persist();
    }
  }

  disableTask(id) {
    const task = this.tasks.get(id);
    if (task) {
      task.enabled = false;
      this._persist();
    }
  }

  deleteTask(id) {
    this._stopJob(id);
    this.tasks.delete(id);
    this._persist();
  }

  listTasks() {
    return Array.from(this.tasks.values());
  }

  stopAll() {
    for (const [id] of this._cronJobs) {
      this._stopJob(id);
    }
    for (const [id, timer] of this._timers) {
      clearTimeout(timer);
      this._timers.delete(id);
    }
  }

  _scheduleCron(id, schedule, callback) {
    this._stopJob(id);
    const job = cron.schedule(schedule, callback);
    this._cronJobs.set(id, job);
  }

  _stopJob(id) {
    const job = this._cronJobs.get(id);
    if (job) {
      job.stop();
      this._cronJobs.delete(id);
    }
    const timer = this._timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._timers.delete(id);
    }
  }

  _persist() {
    if (!this.config.persistPath) return;
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => this._flushToDisk(), 1000);
  }

  _flushToDisk() {
    if (!this.config.persistPath) return;
    const dir = dirname(this.config.persistPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const data = JSON.stringify(Array.from(this.tasks.values()), null, 2);
    const tmp = this.config.persistPath + '.tmp';
    writeFileSync(tmp, data);
    renameSync(tmp, this.config.persistPath);
  }

  _loadFromDisk() {
    if (!this.config.persistPath || !existsSync(this.config.persistPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.config.persistPath, 'utf-8'));
      for (const task of data) {
        this.tasks.set(task.id, task);
        if (task.enabled && task.schedule && cron.validate(task.schedule)) {
          const eventType = `schedule:${task.type}`;
          this._scheduleCron(task.id, task.schedule, () => {
            if (!this.tasks.get(task.id)?.enabled) return;
            this.bus.emit(eventType, task);
          });
        }
      }
    } catch {
      // Corrupted file — start fresh
    }
  }
}
