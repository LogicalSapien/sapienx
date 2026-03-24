import { v4 as uuidv4 } from 'uuid';
import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import paths from '../config/paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

export class Agent {
  constructor(bus, config, { sessionManager, skillLoader, cliAdapters, gateway, scheduler }) {
    this.bus = bus;
    this.config = config;

    // Load identity files from ~/.sapienx/ (copy defaults if missing)
    this._loadIdentityFiles();
    this.sessionManager = sessionManager;
    this.skillLoader = skillLoader;
    this.cliAdapters = cliAdapters;
    this.gateway = gateway;
    this.scheduler = scheduler;
    this._activeInvocations = 0;
    this._sessionQueues = new Map(); // per-session FIFO to prevent concurrent CLI calls
    this._sessionProcessing = new Map();

    this.bus.on('message:routed', (msg) => this._enqueueMessage(msg));
    this.bus.on('schedule:reminder', (data) => this._handleReminder(data));
    this.bus.on('schedule:cron', (data) => this._handleCron(data));
    this.bus.on('schedule:smart', (data) => this._handleSmartTask(data));
    this.bus.on('task:reply', (data) => this._handleTaskReply(data));
  }

  _enqueueMessage(msg) {
    const session = this.sessionManager.resolveSession(msg.channel, msg.from);
    const key = session.sessionId;
    if (!this._sessionQueues.has(key)) {
      this._sessionQueues.set(key, []);
    }
    this._sessionQueues.get(key).push(msg);
    if (!this._sessionProcessing.get(key)) {
      this._processSessionQueue(key);
    }
  }

  async _processSessionQueue(key) {
    this._sessionProcessing.set(key, true);
    const queue = this._sessionQueues.get(key);
    while (queue && queue.length > 0) {
      const msg = queue.shift();
      try {
        await this._handleMessage(msg);
      } catch (err) {
        this.bus.emitError('agent', err);
      }
    }
    this._sessionProcessing.set(key, false);
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
        const delayMs = this._parseRemindTime(reminderText);
        const msgMatch = reminderText.match(/"(.+?)"\s*$/);
        const reminderMsg = msgMatch ? msgMatch[1] : null;
        if (delayMs && reminderMsg) {
          const id = this.scheduler.addReminder({
            message: reminderMsg, channel: msg.channel,
            to: msg.metadata?.chatId || msg.from, delayMs
          });
          this._reply(msg, `Reminder set (${id}): "${reminderMsg}" in ${Math.round(delayMs / 60000)}m`);
        } else {
          this._reply(msg, 'Usage: /remind in 30m "message" | /remind at 14:30 "message" | /remind tomorrow at 9:00 "message"');
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
      case '/heartbeat': {
        if (args[0] === 'start') {
          const interval = args[1] || '30m';
          const schedule = args[2] || '0 */1 * * *'; // default: every hour
          if (this.scheduler) {
            // Read HEARTBEAT.md for the check prompt
            let heartbeatPrompt = 'Check if anything needs attention. Read ~/.sapienx/defaults/HEARTBEAT.md for instructions. If nothing urgent, stay silent.';
            try {
              const hbPath = join(paths.home, 'HEARTBEAT.md');
              if (existsSync(hbPath)) {
                heartbeatPrompt = readFileSync(hbPath, 'utf-8');
              }
            } catch {}
            const id = this.scheduler.addCron({
              id: 'heartbeat',
              schedule,
              command: `ai: ${heartbeatPrompt}`,
              channel: msg.channel,
              to: msg.metadata?.chatId || msg.from
            });
            this._reply(msg, `Heartbeat started (${schedule}). Edit ~/.sapienx/HEARTBEAT.md to customize checks.`);
          }
          return true;
        }
        if (args[0] === 'stop') {
          if (this.scheduler) {
            this.scheduler.deleteTask('heartbeat');
            this._reply(msg, 'Heartbeat stopped.');
          }
          return true;
        }
        this._reply(msg, 'Usage: /heartbeat start [schedule] | /heartbeat stop\nDefault: every hour. Example: /heartbeat start "*/30 * * * *"');
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
      '',
      '*Sessions*',
      '/new — New session',
      '/session <name> — Pin session',
      '/session close — Unpin',
      '/sessions — List sessions',
      '',
      '*Scheduling*',
      '/remind in 5m "msg" — Set reminder',
      '/remind at 14:30 "msg" — Remind at time',
      '/cron "expr" cmd — Recurring task',
      '/task list — List tasks',
      '/task pause/resume/delete <id>',
      '',
      '*Heartbeat*',
      '/heartbeat start — Start proactive checks (hourly)',
      '/heartbeat start "*/30 * * * *" — Custom schedule',
      '/heartbeat stop — Stop heartbeat',
      '',
      '*System*',
      '/cli <name> — Switch CLI',
      '/model <name> — Switch model',
      '/status — System status',
      '/version — Version',
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

  _getFallbackAdapters(primaryName) {
    // Return other available adapters for failover
    return Object.entries(this.cliAdapters)
      .filter(([name]) => name !== primaryName)
      .map(([name, adapter]) => ({ name, adapter }));
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

    this._sendTyping(msg);
    this._activeInvocations++;

    const model = this._resolveModel(session, msg);
    const systemPrompt = this._buildSystemPrompt(session, msg);
    const history = this._getConversationHistory(msg.channel, msg.from);
    const fullPrompt = history
      ? `${systemPrompt}\n\n--- Conversation History ---\n${history}\n\nUser: ${msg.text}`
      : `${systemPrompt}\n\nUser: ${msg.text}`;

    const typingInterval = setInterval(() => this._sendTyping(msg), 5000);
    let replied = false;

    try {
      let result = await adapter.invoke(fullPrompt, session.sessionId, {
        model,
        onChunk: () => this._sendTyping(msg)
      });
      result = await this._extractAndExecuteCommands(result, msg, session);
      this._reply(msg, result);
      this._addToHistory(msg.channel, msg.from, msg.text, result);
      replied = true;
    } catch (err) {
      // On auth error or rate limit, try failover to another CLI
      if (err.isAuthError || err.isRateLimit) {
        const primaryName = adapter.name;
        const reason = err.isAuthError ? 'auth expired' : 'rate limited';
        console.error(`[Agent] ${primaryName} ${reason} — trying failover`);

        const fallbacks = this._getFallbackAdapters(primaryName);
        let failedOver = false;

        for (const { name, adapter: fallback } of fallbacks) {
          try {
            console.log(`[Agent] Failing over to ${name}`);
            let result = await fallback.invoke(fullPrompt, session.sessionId, {
              onChunk: () => this._sendTyping(msg)
            });
            result = await this._extractAndExecuteCommands(result, msg, session);
            this._reply(msg, `[Switched to ${name} — ${primaryName} ${reason}]\n\n${result}`);
            this._addToHistory(msg.channel, msg.from, msg.text, result);
            replied = true;
            failedOver = true;
            break;
          } catch (fbErr) {
            console.error(`[Agent] Failover to ${name} also failed: ${fbErr.message?.substring(0, 100)}`);
          }
        }

        if (!failedOver) {
          if (err.isAuthError) {
            this._reply(msg, `⚠️ ${primaryName} session expired. No fallback CLI available. SSH in and run: claude login`);
          } else {
            this._reply(msg, `⚠️ ${primaryName} rate limited. No fallback CLI available. Try again later.`);
          }
          replied = true;
        }
      } else {
        // Non-auth, non-rate-limit error — retry once with same adapter
        try {
          let result = await adapter.invoke(fullPrompt, session.sessionId, { model });
          result = await this._extractAndExecuteCommands(result, msg, session);
          this._reply(msg, result);
          this._addToHistory(msg.channel, msg.from, msg.text, result);
          replied = true;
        } catch (retryErr) {
          if (retryErr.message?.includes('timed out')) {
            this._reply(msg, '⏱️ Request timed out. Try a simpler question or try again.');
          } else {
            this._reply(msg, `Something went wrong: ${retryErr.message?.substring(0, 200)}`);
          }
          replied = true;
        }
      }
      this.bus.emitError('agent', err);
    } finally {
      clearInterval(typingInterval);
      this._activeInvocations--;
      if (!replied) {
        this._reply(msg, 'Something went wrong processing your message. Please try again.');
      }
    }
  }

  _sendTyping(msg) {
    if (msg.metadata?.rawMsg) {
      msg.metadata.rawMsg.getChat?.().then(chat => {
        chat?.sendStateTyping?.().catch(() => {});
      }).catch(() => {});
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

  _getConversationHistory(channel, from) {
    const key = `${channel}-${from}`;
    const history = this._conversationHistory?.get(key);
    if (!history || history.length === 0) return '';
    // Include last 5 exchanges max to keep prompt size manageable
    return history.slice(-5).map(h =>
      `User: ${h.user}\nAssistant: ${h.assistant}`
    ).join('\n\n');
  }

  _addToHistory(channel, from, userMsg, assistantMsg) {
    if (!this._conversationHistory) this._conversationHistory = new Map();
    const key = `${channel}-${from}`;
    if (!this._conversationHistory.has(key)) {
      this._conversationHistory.set(key, []);
    }
    const history = this._conversationHistory.get(key);
    // Truncate assistant response for history (keep it brief)
    const truncated = assistantMsg.length > 500
      ? assistantMsg.substring(0, 500) + '...'
      : assistantMsg;
    history.push({ user: userMsg, assistant: truncated });
    // Keep max 10 exchanges
    if (history.length > 10) history.shift();
  }

  _loadIdentityFiles() {
    const defaultsDir = join(projectRoot, 'defaults');

    // Copy defaults to ~/.sapienx/ if missing
    for (const file of ['SOUL.md', 'IDENTITY.md', 'USER.md', 'HEARTBEAT.md']) {
      const target = join(paths.home, file);
      const source = join(defaultsDir, file);
      if (!existsSync(target) && existsSync(source)) {
        copyFileSync(source, target);
        console.log(`[Agent] Created ${target} from defaults`);
      }
    }

    // Load files (graceful fallback to empty)
    const load = (filePath) => {
      try { return readFileSync(filePath, 'utf-8'); } catch { return ''; }
    };

    this._soul = load(paths.soul);
    this._identity = load(paths.identity);
    this._user = load(paths.user);
  }

  _buildSystemPrompt(session, msg) {
    const skills = this.skillLoader.getSkillSummaries();
    const skillList = skills.map(s => `- ${s.name}: ${s.description} (triggers: ${s.triggers.join(', ')})`).join('\n');
    const summary = session._previousSummary || '';
    const ownerName = this.config.owner?.name || 'the owner';
    const channel = msg?.channel || session.channel || 'unknown';

    const isGroup = msg?.metadata?.isGroup || false;
    const groupName = msg?.metadata?.groupName || msg?.metadata?.groupId || '';
    const today = new Date().toISOString().split('T')[0];

    return [
      // Identity layer
      this._identity,
      `You are a personal AI assistant for ${ownerName}.`,
      `Running on ${ownerName}'s system. Channel: ${channel.toUpperCase()}.`,
      `Date: ${today}. Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`,
      isGroup ? `\nYou are in a GROUP CHAT${groupName ? ` (${groupName})` : ''}. Apply group chat intelligence rules from your SOUL — only respond when valuable.` : '',
      '',
      // Soul layer (capabilities, behavior, scheduling)
      this._soul,
      '',
      // Dynamic context
      'Available skills (fast-path, no AI needed):',
      skillList,
      '',
      // Memory context
      `Daily log: ~/.sapienx/memory/${today}.md — read it for today's context, write to it to remember things.`,
      'Long-term memory: ~/.sapienx/memory/MEMORY.md — read for curated context.',
      '',
      summary ? `Previous conversation was about: ${summary}` : '',
      '',
      // User layer
      this._user ? '--- User Profile ---' : '',
      this._user || ''
    ].filter(Boolean).join('\n');
  }

  async _extractAndExecuteCommands(text, msg, session) {
    const commandPattern = /\{\{(\/\w+[^}]*)\}\}/g;
    let cleanText = text;
    let match;

    while ((match = commandPattern.exec(text)) !== null) {
      const command = match[1].trim();
      console.log(`[Agent] Executing embedded command: ${command}`);

      try {
        this._executeEmbeddedCommand(command, msg);
      } catch (err) {
        console.error(`[Agent] Embedded command failed: ${err.message}`);
      }

      // Remove the {{command}} from the response text
      cleanText = cleanText.replace(match[0], '').trim();
    }

    // Clean up double spaces/newlines left by removal
    return cleanText.replace(/\n{3,}/g, '\n\n').trim();
  }

  _executeEmbeddedCommand(command, msg) {
    const parts = command.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const argsStr = command.slice(cmd.length).trim();

    if (cmd === '/remind' && this.scheduler) {
      const delayMs = this._parseRemindTime(argsStr);
      if (delayMs !== null) {
        // Extract message — everything after the time part in quotes
        const msgMatch = argsStr.match(/"(.+?)"\s*$/);
        const message = msgMatch ? msgMatch[1] : argsStr.replace(/^.*?\d+[mhd]\s*/i, '').replace(/^"?|"?$/g, '').replace(/^at\s+\S+\s*/i, '').trim();
        if (message) {
          const id = this.scheduler.addReminder({
            message,
            channel: msg.channel,
            to: msg.metadata?.chatId || msg.from,
            delayMs
          });
          console.log(`[Agent] Reminder set (${id}): "${message}" in ${Math.round(delayMs / 60000)}m`);
        }
      }
    } else if (cmd === '/cron' && this.scheduler) {
      const cronMatch = command.match(/^\/cron\s+"([^"]+)"\s+(.+)$/);
      if (cronMatch) {
        const id = this.scheduler.addCron({
          schedule: cronMatch[1],
          command: cronMatch[2],
          channel: msg.channel,
          to: msg.metadata?.chatId || msg.from
        });
        console.log(`[Agent] Cron set (${id}): "${cronMatch[1]}" → ${cronMatch[2]}`);
      }
    }
  }

  _parseRemindTime(argsStr) {
    // Format: in <N>m|h|d "message"
    const inMatch = argsStr.match(/^in\s+(\d+)([mhd])\b/i);
    if (inMatch) {
      const multipliers = { m: 60000, h: 3600000, d: 86400000 };
      return parseInt(inMatch[1]) * multipliers[inMatch[2]];
    }

    // Format: at HH:MM "message" (24h or with am/pm)
    const atMatch = argsStr.match(/^at\s+(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
    if (atMatch) {
      let hours = parseInt(atMatch[1]);
      const mins = parseInt(atMatch[2]);
      const ampm = atMatch[3]?.toLowerCase();
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      const now = new Date();
      const target = new Date(now);
      target.setHours(hours, mins, 0, 0);
      // If time already passed today, schedule for tomorrow
      if (target <= now) target.setDate(target.getDate() + 1);
      return target.getTime() - now.getTime();
    }

    // Format: tomorrow at HH:MM "message"
    const tomorrowMatch = argsStr.match(/^tomorrow\s+(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?\b/i);
    if (tomorrowMatch) {
      let hours = parseInt(tomorrowMatch[1]);
      const mins = parseInt(tomorrowMatch[2]);
      const ampm = tomorrowMatch[3]?.toLowerCase();
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      const now = new Date();
      const target = new Date(now);
      target.setDate(target.getDate() + 1);
      target.setHours(hours, mins, 0, 0);
      return target.getTime() - now.getTime();
    }

    return null;
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
    const message = data.message || '';

    // If message starts with "ai:" — route through Claude CLI as a full agent message
    if (message.startsWith('ai:')) {
      const prompt = message.slice(3).trim();
      console.log(`[Agent] Reminder → Claude CLI: "${prompt.substring(0, 80)}"`);

      // Notify user that the reminder fired and is being processed
      this.bus.emit('message:outgoing', {
        id: uuidv4(),
        channel: data.channel,
        to: data.to,
        text: `⏰ Reminder triggered — processing: "${prompt.substring(0, 100)}"`,
        timestamp: Date.now(),
        metadata: {}
      });

      // Route through the agent as if the owner sent this message
      this.bus.emit('message:routed', {
        id: uuidv4(),
        channel: data.channel,
        from: this.config.owner.phone || data.to,
        text: prompt,
        timestamp: Date.now(),
        metadata: { chatId: data.to, fromReminder: true }
      });
      return;
    }

    // Regular reminder — just send the text
    this.bus.emit('message:outgoing', {
      id: uuidv4(),
      channel: data.channel,
      to: data.to,
      text: `Reminder: ${message}`,
      timestamp: Date.now(),
      metadata: {}
    });
  }

  async _handleCron(data) {
    const command = data.command || '';

    // ai: prefix means route through Claude CLI
    const text = command.startsWith('ai:') ? command.slice(3).trim() : command;

    this.bus.emit('message:routed', {
      id: uuidv4(),
      channel: data.channel,
      from: this.config.owner.phone || 'tui',
      text,
      timestamp: Date.now(),
      metadata: { chatId: data.to, fromCron: true }
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
