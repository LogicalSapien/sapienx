import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { BaseChannel } from './base.js';
import { toWhatsApp } from './formatter.js';
import paths from '../config/paths.js';

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
      authStrategy: new LocalAuth({ dataPath: paths.waAuth }),
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

    this._attachMessageListener();

    // Initialize with retry — puppeteer can crash during QR scan navigation
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.client.initialize();
        break;
      } catch (err) {
        console.error(`[WhatsApp] Init attempt ${attempt}/3 failed: ${err.message}`);
        if (attempt === 3) {
          console.error('[WhatsApp] Failed to initialize after 3 attempts.');
          this.bus.emitError('whatsapp', err);
          return;
        }
        // Destroy and recreate client for retry
        try { await this.client.destroy(); } catch {}
        this.client = new Client({
          authStrategy: new LocalAuth({ dataPath: paths.waAuth }),
          puppeteer: {
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
          }
        });
        // Re-attach event listeners
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
        });
        this._attachMessageListener();
        console.log(`[WhatsApp] Retrying in 3 seconds...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }

  _attachMessageListener() {
    this.client.on('message_create', async (msg) => {
      if (msg.isStatus) return;
      if (this._sentIds.has(msg.id._serialized)) return;

      if (msg.fromMe) {
        const chat = await msg.getChat();
        if (!chat.isGroup && chat.id._serialized === msg.from) {
          console.log(`[WhatsApp] Self-chat message: "${msg.body?.substring(0, 50)}"`);
        } else {
          return;
        }
      }

      console.log(`[WhatsApp] Message from ${msg.from}: "${msg.body?.substring(0, 50)}"`);
      await this._handleIncoming(msg);
    });
  }

  async _handleIncoming(msg) {
    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const from = msg.from.replace(/@(c\.us|g\.us|lid)$/, '');
    const senderId = isGroup
      ? msg.author?.replace(/@(c\.us|lid)$/, '') || from
      : from;

    // Resolve phone number from contact (needed for LID format)
    let senderPhone = senderId;
    try {
      const contact = await msg.getContact();
      if (contact?.number) {
        senderPhone = contact.number.replace(/^\+/, '');
      }
    } catch {}

    // Detect self-chat
    const isSelfChat = !isGroup && chat.id._serialized === msg.from;

    this.bus.emit('message:incoming', {
      id: msg.id._serialized,
      channel: 'whatsapp',
      from: senderPhone,
      text: msg.body,
      timestamp: msg.timestamp * 1000,
      metadata: {
        isGroup,
        isSelfChat,
        groupId: isGroup ? msg.from : null,
        chatId: msg.from,
        senderId: senderId,
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
      throw new Error('WhatsApp not connected');
    }

    const to = message.to || message.metadata?.chatId;
    if (!to) {
      throw new Error('No recipient specified');
    }

    const chatId = to.includes('@') ? to : `${to}@c.us`;
    const formatted = toWhatsApp(message.text);
    const sent = await this.client.sendMessage(chatId, formatted);
    // Track sent IDs so we don't process our own responses
    if (sent?.id?._serialized) this._sentIds.add(sent.id._serialized);
    if (this._sentIds.size > 500) {
      const arr = [...this._sentIds];
      this._sentIds = new Set(arr.slice(-250));
    }
    console.log(`[WhatsApp] Sent reply to ${chatId}`);
  }

  isConnected() {
    return this.ready;
  }
}
