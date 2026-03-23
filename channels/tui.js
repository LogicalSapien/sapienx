import { createInterface } from 'node:readline';
import { BaseChannel } from './base.js';
import { toTui } from './formatter.js';

export class TuiChannel extends BaseChannel {
  constructor(bus, config) {
    super(bus, config);
    this.name = 'tui';
    this.rl = null;
  }

  async start() {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '\n\x1b[36msapienx>\x1b[0m '
    });

    this.bus.on('message:status', (msg) => {
      if (msg.channel === 'tui') {
        process.stdout.write(`\r\x1b[33m${msg.text}\x1b[0m`);
      }
    });

    this.rl.on('line', (line) => {
      const text = line.trim();
      if (!text) {
        this.rl.prompt();
        return;
      }

      if (text === '/quit' || text === '/exit') {
        console.log('\nGoodbye!');
        this.bus.emit('shutdown');
        return;
      }

      this.bus.emit('message:incoming', {
        id: `tui-${Date.now()}`,
        channel: 'tui',
        from: 'tui',
        text,
        timestamp: Date.now(),
        metadata: {}
      });
    });

    this.rl.on('close', () => {
      this.bus.emit('shutdown');
    });

    console.log('\x1b[32mSapienX TUI ready.\x1b[0m Type /help for commands, /quit to exit.');
    this.rl.prompt();
  }

  async stop() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  async send(message) {
    this._display(message.text);
  }

  isConnected() {
    return !!this.rl;
  }

  _display(text) {
    const formatted = toTui(text);
    console.log(`\n\x1b[37m${formatted}\x1b[0m`);
    if (this.rl) this.rl.prompt();
  }
}
