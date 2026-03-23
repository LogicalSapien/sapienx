import { v4 as uuidv4 } from 'uuid';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export class Agent {
  constructor(bus, config, { sessionManager, skillLoader, cliAdapters, gateway, scheduler }) {
    this.bus = bus;
    this.config = config;

    // Load SAPIENX.md reference doc for system prompt
    try {
      this._referenceDoc = readFileSync(join(__dirname, '..', 'SAPIENX.md'), 'utf-8');
    } catch {
      this._referenceDoc = '';
    }
    this.sessionManager = sessionManager;
    this.skillLoader = skillLoader;
    this.cliAdapters = cliAdapters;
    this.gateway = gateway;
    this.scheduler = scheduler;
    this._activeInvocations = 0;
    this._queue = [];

    this.bus.on('message:routed', (msg) => this._handleMessage(msg));
    this.bus.on('schedule:reminder', (data) => this._handleReminder(data));
    this.bus.on('schedule:cron', (data) => this._handleCron(data));
    this.bus.on('schedule:smart', (data) => this._handleSmartTask(data));
    this.bus.on('task:reply', (data) => this._handleTaskReply(data));
  }

  async _handleMessage(msg) {
    const session = this.sessionManager.resolveSession(msg.channel, msg.from);
    msg.sessionId = session.sessionId;
    this.sessionManager.bufferMessage(msg.channel, msg.from, msg.text);

    // Command handling
    if (msg.text.startsWith('/')) {
      const handled = await this._handleCommand(msg, session);
      if (handled) return;
    }

    // Skill matching
    const skill = this.skillLoader.matchSkill(msg.text);
    if (skill) {
      this.bus.emit('skill:matched', { skill: skill.name, message: msg.text });

      if (skill.mode === 'handler' && skill.handler) {
        const result = await skill.handler(msg.text, {
          text: msg.text,
          config: this.config,
          bus: this.bus,
          session
        });
        this._reply(msg, result);
        return;
      }

      if (skill.mode === 'prompt') {
        await this._invokeCliWithSkill(msg, session, skill);
        return;
      }
    }

    // Default: invoke CLI
    await this._invokeCli(msg, session);
  }

  async _handleCommand(msg, session) {
    const parts = msg.text.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case '/new': {
        this.sessionManager.forceNewSession(msg.channel, msg.from);
        this._reply(msg, 'New session started.');
        return true;
      }
      case '/session': {
        if (args[0] === 'close') {
          this.sessionManager.unpinSession(msg.channel, msg.from);
          this._reply(msg, 'Session unpinned.');
        } else if (args[0]) {
          this.sessionManager.pinSession(msg.channel, msg.from, args[0]);
          this._reply(msg, `Pinned session: ${args[0]}`);
        }
        return true;
      }
      case '/sessions': {
        const sessions = this.sessionManager.listSessions();
        const lines = sessions.map(s =>
          `${s.sessionId} [${s.channel}] ${s.pinned ? '(pinned)' : ''} ${s.topic || ''}`
        );
        this._reply(msg, lines.join('\n') || 'No active sessions.');
        return true;
      }
      case '/cli': {
        if (args[0]) {
          this.sessionManager.setOverride(msg.channel, msg.from, 'cli', args[0]);
          this._reply(msg, `CLI switched to: ${args[0]}`);
        }
        return true;
      }
      case '/model': {
        if (args[0]) {
          const model = args[0] === 'auto' ? null : args[0];
          this.sessionManager.setOverride(msg.channel, msg.from, 'model', model);
          this._reply(msg, model ? `Model switched to: ${model}` : 'Auto-model enabled.');
        }
        return true;
      }
      case '/auto': {
        this.sessionManager.setOverride(msg.channel, msg.from, 'model', null);
        this._reply(msg, 'Auto-model enabled.');
        return true;
      }
      case '/status': {
        const info = this._getStatus();
        this._reply(msg, info);
        return true;
      }
      case '/version': {
        this._reply(msg, `SapienX v1.0.0`);
        return true;
      }
      case '/remind': {
        if (!this.scheduler) { this._reply(msg, 'Scheduler not available.'); return true; }
        const reminderText = args.join(' ');
        // Parse "in 30m" or "8am" or "every weekday 8am"
        const inMatch = reminderText.match(/^in\s+(\d+)([mhd])\s+"?(.+?)"?$/i);
        if (inMatch) {
          const multipliers = { m: 60000, h: 3600000, d: 86400000 };
          const delayMs = parseInt(inMatch[1]) * multipliers[inMatch[2]];
          const id = this.scheduler.addReminder({
            message: inMatch[3], channel: msg.channel,
            to: msg.metadata?.chatId || msg.from, delayMs
          });
          this._reply(msg, `Reminder set (${id}): "${inMatch[3]}" in ${inMatch[1]}${inMatch[2]}`);
        } else {
          this._reply(msg, 'Usage: /remind in 30m "message" or /remind "0 8 * * *" "message"');
        }
        return true;
      }
      case '/cron': {
        if (!this.scheduler) { this._reply(msg, 'Scheduler not available.'); return true; }
        const cronMatch = msg.text.match(/^\/cron\s+"([^"]+)"\s+(.+)$/);
        if (cronMatch) {
          const id = this.scheduler.addCron({
            schedule: cronMatch[1], command: cronMatch[2],
            channel: msg.channel, to: msg.metadata?.chatId || msg.from
          });
          this._reply(msg, `Cron job set (${id}): "${cronMatch[1]}" → ${cronMatch[2]}`);
        } else {
          this._reply(msg, 'Usage: /cron "0 9 * * *" /vps df -h');
        }
        return true;
      }
      case '/task': {
        if (!this.scheduler) { this._reply(msg, 'Scheduler not available.'); return true; }
        const subCmd = args[0];
        if (subCmd === 'list') {
          const tasks = this.scheduler.listTasks();
          const lines = tasks.map(t => `${t.id} [${t.type}] ${t.enabled ? 'ON' : 'OFF'} — ${t.schedule || 'one-off'}`);
          this._reply(msg, lines.join('\n') || 'No scheduled tasks.');
        } else if (subCmd === 'pause' && args[1]) {
          this.scheduler.disableTask(args[1]);
          this._reply(msg, `Task "${args[1]}" paused.`);
        } else if (subCmd === 'resume' && args[1]) {
          this.scheduler.enableTask(args[1]);
          this._reply(msg, `Task "${args[1]}" resumed.`);
        } else if (subCmd === 'delete' && args[1]) {
          this.scheduler.deleteTask(args[1]);
          this._reply(msg, `Task "${args[1]}" deleted.`);
        } else if (subCmd === 'create') {
          this._reply(msg, 'Usage: /task create "name" --schedule "cron" --prompt "..." --channel whatsapp --to "phone" --followup 10m --maxRetries 3');
        } else {
          this._reply(msg, 'Usage: /task list | create | pause <id> | resume <id> | delete <id>');
        }
        return true;
      }
      case '/help': {
        this._reply(msg, this._getHelp());
        return true;
      }
      default:
        // Check if it's a skill-specific command like /vps
        return false;
    }
  }

  _getStatus() {
    const sessions = this.sessionManager.listSessions();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const mem = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
    return [
      `Uptime: ${hours}h ${mins}m`,
      `Active sessions: ${sessions.length}`,
      `Memory: ${mem}MB`,
      `CLI adapter: ${this.config.cli.default}`,
      `Active CLI invocations: ${this._activeInvocations}/${this.config.cli.maxConcurrent}`
    ].join('\n');
  }

  _getHelp() {
    return [
      '*SapienX Commands*',
      '/new — New session',
      '/session <name> — Pin a named session',
      '/session close — Unpin session',
      '/sessions — List sessions',
      '/cli <name> — Switch CLI adapter',
      '/model <name> — Switch model',
      '/model auto — Auto-select model',
      '/status — System status',
      '/version — Version info',
      '/vps <cmd> — Run shell command',
      '/remind in <time> "msg" — Set reminder',
      '/cron "<expr>" <cmd> — Schedule recurring command',
      '/task list — List scheduled tasks',
      '/task pause/resume/delete <id> — Manage tasks',
      '/help — This message'
    ].join('\n');
  }

  _resolveAdapter(session, msg) {
    // Resolution order: session > group > channel > global default
    if (session.cliOverride) return this.cliAdapters[session.cliOverride];
    if (msg?.groupConfig?.cli) return this.cliAdapters[msg.groupConfig.cli];
    const channelConfig = this.config.channels[msg?.channel];
    if (channelConfig?.cli) return this.cliAdapters[channelConfig.cli];
    return this.cliAdapters[this.config.cli.default];
  }

  _resolveModel(session, msg) {
    // Resolution order: session > group > channel > adapter > global
    if (session.modelOverride) return session.modelOverride;
    if (msg?.groupConfig?.model) return msg.groupConfig.model;
    const channelConfig = this.config.channels[msg?.channel];
    if (channelConfig?.model) return channelConfig.model;
    const adapterName = session.cliOverride || this.config.cli.default;
    const adapterConfig = this.config.cli.adapters[adapterName];
    return adapterConfig?.autoModel ? null : adapterConfig?.model;
  }

  async _invokeCli(msg, session) {
    const adapter = this._resolveAdapter(session, msg);
    if (!adapter) {
      this._reply(msg, 'No CLI adapter available.');
      return;
    }

    if (this._activeInvocations >= this.config.cli.maxConcurrent) {
      this._reply(msg, 'Processing, please wait...');
      await new Promise(resolve => {
        const check = () => {
          if (this._activeInvocations < this.config.cli.maxConcurrent) {
            resolve();
          } else {
            setTimeout(check, 500);
          }
        };
        check();
      });
    }

    this._activeInvocations++;
    const model = this._resolveModel(session, msg);
    const systemPrompt = this._buildSystemPrompt(session, msg);

    try {
      const fullPrompt = `${systemPrompt}\n\nUser: ${msg.text}`;
      const result = await adapter.invoke(fullPrompt, session.sessionId, {
        model,
        onChunk: (chunk) => {
          this.bus.emit('message:status', {
            channel: msg.channel,
            text: 'typing...'
          });
        }
      });
      this._reply(msg, result);
    } catch (err) {
      // Retry once
      try {
        const fullPrompt = `${systemPrompt}\n\nUser: ${msg.text}`;
        const result = await adapter.invoke(fullPrompt, session.sessionId, { model });
        this._reply(msg, result);
      } catch (retryErr) {
        this._reply(msg, `Error: ${retryErr.message}`);
        this.bus.emitError('agent', retryErr);
      }
    } finally {
      this._activeInvocations--;
    }
  }

  async _invokeCliWithSkill(msg, session, skill) {
    const adapter = this._resolveAdapter(session, msg);
    if (!adapter) {
      this._reply(msg, 'No CLI adapter available.');
      return;
    }

    this._activeInvocations++;
    const model = this._resolveModel(session, msg);

    try {
      const systemPrompt = `${this._buildSystemPrompt(session, msg)}\n\n--- Active Skill: ${skill.name} ---\n${skill.promptBody}`;
      const fullPrompt = `${systemPrompt}\n\nUser: ${msg.text}`;
      const result = await adapter.invoke(fullPrompt, session.sessionId, { model });
      this._reply(msg, result);
    } catch (err) {
      this._reply(msg, `Error: ${err.message}`);
      this.bus.emitError('agent', err);
    } finally {
      this._activeInvocations--;
    }
  }

  _buildSystemPrompt(session, msg) {
    const skills = this.skillLoader.getSkillSummaries();
    const skillList = skills.map(s => `- ${s.name}: ${s.description} (triggers: ${s.triggers.join(', ')})`).join('\n');
    const summary = session._previousSummary || '';
    const ownerName = this.config.owner?.name || 'the owner';
    const channel = msg?.channel || session.channel || 'unknown';

    return [
      `You are SapienX, a personal AI assistant for ${ownerName}.`,
      `You are running on ${ownerName}'s system with FULL access to the operating system.`,
      `The user is messaging you via the ${channel.toUpperCase()} channel.`,
      channel === 'tui' ? 'They are using the terminal/TUI interface directly.' : '',
      channel === 'whatsapp' ? 'They are messaging you via WhatsApp.' : '',
      '',
      'CAPABILITIES:',
      '- You have full Bash/shell access. You can run any command on this system.',
      '- You can read, write, and edit files anywhere on the filesystem.',
      '- You can browse the web (WebSearch, WebFetch).',
      '- You can install packages, manage services, check logs, deploy code.',
      '- You can do multi-step agentic tasks: research, code, test, deploy.',
      '- You run with --dangerously-skip-permissions so no tool requires approval.',
      '',
      'BEHAVIOR:',
      '- Execute commands and tasks directly. Don\'t just suggest — DO it.',
      '- If the user asks to check something, run the actual command and report results.',
      '- If the user asks to fix something, make the fix and confirm it\'s done.',
      '- For WhatsApp: keep responses concise. Show key output, not full dumps.',
      '- For TUI: you can be more detailed.',
      '',
      'Available skills (fast-path, no AI needed):',
      skillList,
      '',
      summary ? `Previous conversation was about: ${summary}` : '',
      '',
      this._referenceDoc ? '--- SapienX Reference Documentation ---' : '',
      this._referenceDoc ? 'Use this to answer any questions about SapienX usage, configuration, commands, architecture, or troubleshooting.' : '',
      this._referenceDoc || ''
    ].filter(Boolean).join('\n');
  }

  _reply(msg, text) {
    this.bus.emit('message:outgoing', {
      id: uuidv4(),
      channel: msg.channel,
      to: msg.metadata?.chatId || msg.from,
      text,
      timestamp: Date.now(),
      metadata: msg.metadata || {}
    });
  }

  async _handleReminder(data) {
    this.bus.emit('message:outgoing', {
      id: uuidv4(),
      channel: data.channel,
      to: data.to,
      text: `Reminder: ${data.message}`,
      timestamp: Date.now(),
      metadata: {}
    });
  }

  async _handleCron(data) {
    // Cron commands are processed as if the owner sent them
    this.bus.emit('message:routed', {
      id: uuidv4(),
      channel: data.channel,
      from: this.config.owner.phone || 'tui',
      text: data.command,
      timestamp: Date.now(),
      metadata: {}
    });
  }

  async _handleSmartTask(data) {
    // Create a dedicated session for the task
    const session = this.sessionManager.pinSession(
      data.channel, `task-${data.taskId}`, data.taskId
    );

    // Register pending reply
    if (this.gateway) {
      this.gateway.registerPendingReply({
        taskId: data.taskId,
        channel: data.channel,
        expectedFrom: data.to,
        expiresAt: Date.now() + (data.followUp.interval * (data.followUp.maxRetries + 1))
      });
    }

    // Invoke CLI with task prompt
    const adapter = this._resolveAdapter(session);
    if (!adapter) return;

    try {
      this._activeInvocations++;
      const result = await adapter.invoke(data.prompt, session.sessionId, {});
      // Send the AI-generated message to the target
      this.bus.emit('message:outgoing', {
        id: uuidv4(),
        channel: data.channel,
        to: data.to,
        text: result,
        timestamp: Date.now(),
        metadata: {}
      });
    } catch (err) {
      this.bus.emitError('agent', err);
    } finally {
      this._activeInvocations--;
    }

    // Set up follow-up timer
    this._setupFollowUp(data, 0);
  }

  _setupFollowUp(data, retryCount) {
    if (retryCount >= data.followUp.maxRetries) {
      // Escalate to owner
      this.bus.emit('message:outgoing', {
        id: uuidv4(),
        channel: data.channel,
        to: this.config.owner.phone,
        text: `Task "${data.taskId}" timed out after ${retryCount} retries. No response from ${data.to}.`,
        timestamp: Date.now(),
        metadata: {}
      });
      if (this.gateway) this.gateway.removePendingReply(data.taskId);
      return;
    }

    setTimeout(() => {
      // Check if reply was received (pending reply would have been removed)
      if (!this.gateway?.pendingReplies.has(data.taskId)) return;

      // No reply — retry
      this.bus.emit('message:outgoing', {
        id: uuidv4(),
        channel: data.channel,
        to: data.to,
        text: data.prompt,
        timestamp: Date.now(),
        metadata: {}
      });

      this._setupFollowUp(data, retryCount + 1);
    }, data.followUp.interval);
  }

  async _handleTaskReply(data) {
    // A reply to a smart task was received
    const session = this.sessionManager.resolveSession(
      data.message.channel, `task-${data.taskId}`
    );

    // Notify owner
    this.bus.emit('message:outgoing', {
      id: uuidv4(),
      channel: data.message.channel,
      to: this.config.owner.phone,
      text: `Task "${data.taskId}" received reply from ${data.message.from}: ${data.message.text}`,
      timestamp: Date.now(),
      metadata: {}
    });
  }
}
