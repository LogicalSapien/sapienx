import { writeFileSync, mkdirSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import paths from '../config/paths.js';

export class Transcriber {
  constructor(config = {}) {
    this.config = config;
    mkdirSync(paths.mediaTmp, { recursive: true });
  }

  /**
   * Process a WhatsApp media message.
   * Returns { text, filePath } where:
   * - text: transcription for voice, caption for images, or description prompt
   * - filePath: saved file path (for images/docs passed to Claude)
   */
  async process(msg) {
    if (!msg.hasMedia) return null;

    const media = await msg.downloadMedia();
    if (!media) {
      console.error('[Transcriber] Failed to download media');
      return null;
    }

    const ext = this._getExtension(media.mimetype);
    const filename = `${randomUUID()}${ext}`;
    const filePath = join(paths.mediaTmp, filename);
    const buffer = Buffer.from(media.data, 'base64');
    writeFileSync(filePath, buffer);

    const type = msg.type;

    // Voice messages (ptt) and audio files
    if (type === 'ptt' || type === 'audio') {
      const transcription = await this._transcribeAudio(filePath, media.mimetype);
      this._cleanup(filePath);
      return {
        text: transcription,
        filePath: null
      };
    }

    // Images — save and tell Claude to look at it
    if (type === 'image') {
      const caption = msg.body || '';
      return {
        text: caption
          ? `[Image received with caption: "${caption}"] The image is saved at ${filePath} — use the Read tool to view it.`
          : `[Image received] The image is saved at ${filePath} — use the Read tool to view it.`,
        filePath
      };
    }

    // Video — save reference
    if (type === 'video') {
      return {
        text: `[Video received] Saved at ${filePath}. Duration: ${msg.duration || 'unknown'}s.`,
        filePath
      };
    }

    // Documents
    if (type === 'document') {
      const docName = msg.body || media.filename || filename;
      return {
        text: `[Document received: "${docName}"] Saved at ${filePath} — use the Read tool to view it.`,
        filePath
      };
    }

    // Stickers and other types — just note them
    this._cleanup(filePath);
    return {
      text: `[${type} message received — not supported for processing]`,
      filePath: null
    };
  }

  async _transcribeAudio(filePath, mimetype) {
    // Convert to wav if needed (whisper and most tools prefer wav/mp3)
    let wavPath = filePath;
    if (!mimetype.includes('wav') && !mimetype.includes('mp3')) {
      wavPath = filePath.replace(/\.[^.]+$/, '.wav');
      try {
        execSync(`ffmpeg -i "${filePath}" -ar 16000 -ac 1 "${wavPath}" -y 2>/dev/null`, {
          timeout: 30000
        });
      } catch {
        // ffmpeg not available or failed — try with original
        wavPath = filePath;
      }
    }

    // Try OpenAI Whisper API if key available
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      try {
        return await this._whisperApi(wavPath, openaiKey);
      } catch (err) {
        console.error(`[Transcriber] Whisper API failed: ${err.message}`);
      }
    }

    // Try local whisper binary
    try {
      const baseName = wavPath.replace(/\.[^.]+$/, '');
      const txtOutput = `/tmp/${wavPath.split('/').pop().replace(/\.[^.]+$/, '')}.txt`;
      execSync(`whisper "${wavPath}" --model small --language en --output_format txt --output_dir /tmp 2>/dev/null`, {
        timeout: 180000
      });
      const { readFileSync: readF } = await import('node:fs');
      const text = readF(txtOutput, 'utf-8').trim();
      try { unlinkSync(txtOutput); } catch {}
      if (text) {
        console.log(`[Transcriber] Whisper transcribed: "${text.substring(0, 80)}"`);
        return `[Voice message]: ${text}`;
      }
    } catch (err) {
      console.error(`[Transcriber] Local whisper failed: ${err.message?.substring(0, 100)}`);
    }

    // Fallback: keep the file and let Claude handle it
    return `[Voice message received] Audio saved at ${filePath}. Transcription failed — you can try processing the file manually.`;
  }

  async _whisperApi(filePath, apiKey) {
    const { readFileSync } = await import('node:fs');
    const audioData = readFileSync(filePath);
    const filename = filePath.split('/').pop();

    // Build multipart form data manually
    const boundary = '----FormBoundary' + randomUUID().replace(/-/g, '');
    const parts = [];

    // File part
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: audio/wav\r\n\r\n`);
    const filePart = Buffer.from(parts[0]);
    const fileEnd = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}--\r\n`);

    const body = Buffer.concat([filePart, audioData, fileEnd]);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body
    });

    if (!response.ok) {
      throw new Error(`Whisper API ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    return result.text || '[Voice message — transcription empty]';
  }

  _getExtension(mimetype) {
    const map = {
      'audio/ogg': '.ogg',
      'audio/mpeg': '.mp3',
      'audio/wav': '.wav',
      'audio/mp4': '.m4a',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
    };
    return map[mimetype?.split(';')[0]] || '.bin';
  }

  _cleanup(filePath) {
    try { unlinkSync(filePath); } catch {}
    // Also clean wav conversion if exists
    const wavPath = filePath.replace(/\.[^.]+$/, '.wav');
    if (wavPath !== filePath) {
      try { unlinkSync(wavPath); } catch {}
    }
  }

  /**
   * Clean up old media files (older than maxAgeMs, default 1 hour)
   */
  cleanupOldMedia(maxAgeMs = 3600000) {
    try {
      const files = readdirSync(paths.mediaTmp);
      const now = Date.now();
      let cleaned = 0;
      for (const file of files) {
        const filePath = join(paths.mediaTmp, file);
        try {
          const stat = statSync(filePath);
          if (now - stat.mtimeMs > maxAgeMs) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch {}
      }
      if (cleaned > 0) console.log(`[Transcriber] Cleaned ${cleaned} old media file(s)`);
    } catch {}
  }
}
