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
    this._sentIds = new Set();
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

    // message_create fires for ALL messages — both incoming and outgoing.
    // We skip: status broadcasts, and messages WE sent as responses.
    // We process everything else — including self-chat, group msgs, etc.
    this.client.on('message_create', async (msg) => {
      // Skip status broadcasts
      if (msg.isStatus) return;

      // Skip messages that SapienX sent as responses (tracked by ID)
      if (this._sentIds.has(msg.id._serialized)) return;

      // Skip our own outgoing messages UNLESS it's to our own number (self-chat)
      // In self-chat, msg.fromMe is true for messages you type on your phone too
      if (msg.fromMe) {
        // Check if this is a self-chat by looking at the chat
        const chat = await msg.getChat();
        if (!chat.isGroup && chat.id._serialized === msg.from) {
          // This IS self-chat — process it
          console.log(`[WhatsApp] Self-chat message: "${msg.body?.substring(0, 50)}"`);
        } else {
          // Regular outgoing message to someone else — skip
          return;
        }
      }

      console.log(`[WhatsApp] Message from ${msg.from}: "${msg.body?.substring(0, 50)}"`);
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
    try {
      const sent = await this.client.sendMessage(chatId, formatted);
      // Track sent IDs so we don't process our own responses
      if (sent?.id?._serialized) this._sentIds.add(sent.id._serialized);
      if (this._sentIds.size > 500) {
        const arr = [...this._sentIds];
        this._sentIds = new Set(arr.slice(-250));
      }
      console.log(`[WhatsApp] Sent reply to ${chatId}`);
    } catch (err) {
      console.error(`[WhatsApp] Failed to send: ${err.message}`);
    }
  }

  isConnected() {
    return this.ready;
  }
}
