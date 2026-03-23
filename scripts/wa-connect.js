// Standalone WhatsApp connect script — runs in subprocess to isolate puppeteer crashes
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

// Catch ALL errors to prevent crash
process.on('unhandledRejection', () => {});
process.on('uncaughtException', () => {});

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: join(projectRoot, '.wwebjs_auth') }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

let qrShown = false;

client.on('qr', (qr) => {
  qrShown = true;
  console.error('QR_READY');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  try {
    const chats = await client.getChats();
    const groups = chats.filter(c => c.isGroup).map(c => ({
      id: c.id._serialized,
      name: c.name
    }));
    // Output JSON to stdout for parent process
    console.log(JSON.stringify({ status: 'connected', groups }));
  } catch {
    console.log(JSON.stringify({ status: 'connected', groups: [] }));
  }
  await client.destroy().catch(() => {});
  process.exit(0);
});

client.on('auth_failure', () => {
  console.log(JSON.stringify({ status: 'auth_failure', groups: [] }));
  process.exit(1);
});

// Timeout
setTimeout(() => {
  console.log(JSON.stringify({ status: 'timeout', groups: [] }));
  client.destroy().catch(() => {});
  process.exit(1);
}, 60000);

client.initialize().catch(() => {
  // Puppeteer crash during QR scan — session was saved, retry will work
  if (qrShown) {
    // Wait a bit for session to be written, then report
    setTimeout(() => {
      console.log(JSON.stringify({ status: 'qr_scanned_restart_needed', groups: [] }));
      process.exit(2);
    }, 3000);
  } else {
    console.log(JSON.stringify({ status: 'init_failed', groups: [] }));
    process.exit(1);
  }
});
