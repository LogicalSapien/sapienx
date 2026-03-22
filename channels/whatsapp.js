import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { BaseChannel } from './base.js';
import { toWhatsApp } from './formatter.js';

export class WhatsAppChannel extends BaseChannel {
  constructor(bus, config) {
    super(bus, config);
    this.name = 'whatsapp';
    this.client = null;
    this.ready = false;
  }

  async start() {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      }
    });

    this.client.on('qr', (qr) => {
      console.log('\n[WhatsApp] Scan this QR code with your phone:');
      qrcode.generate(qr, { small: true });
    });

    this.client.on('ready', () => {
      this.ready = true;
      console.log('[WhatsApp] Connected and ready.');
      this.bus.emit('channel:ready', { channel: 'whatsapp' });
    });

    this.client.on('disconnected', (reason) => {
      this.ready = false;
      console.error(`[WhatsApp] Disconnected: ${reason}`);
      this.bus.emitError('whatsapp', new Error(`Disconnected: ${reason}`));
    });

    this.client.on('message', async (msg) => {
      await this._handleIncoming(msg);
    });

    this.bus.on('message:outgoing', async (msg) => {
      if (msg.channel === 'whatsapp') {
        await this.send(msg);
      }
    });

    await this.client.initialize();
  }

  async _handleIncoming(msg) {
    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const from = msg.from.replace('@c.us', '').replace('@g.us', '');
    const senderId = isGroup
      ? msg.author?.replace('@c.us', '') || from
      : from;

    this.bus.emit('message:incoming', {
      id: msg.id._serialized,
      channel: 'whatsapp',
      from: senderId,
      text: msg.body,
      timestamp: msg.timestamp * 1000,
      metadata: {
        isGroup,
        groupId: isGroup ? msg.from : null,
        chatId: msg.from,
        rawMsg: msg
      }
    });
  }

  async stop() {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.ready = false;
    }
  }

  async send(message) {
    if (!this.client || !this.ready) {
      console.error('[WhatsApp] Cannot send — not connected');
      return;
    }

    const to = message.to || message.metadata?.chatId;
    if (!to) {
      console.error('[WhatsApp] Cannot send — no recipient');
      return;
    }

    const chatId = to.includes('@') ? to : `${to}@c.us`;
    const formatted = toWhatsApp(message.text);
    await this.client.sendMessage(chatId, formatted);
  }

  isConnected() {
    return this.ready;
  }
}
