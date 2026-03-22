import { spawn } from 'node:child_process';
import { BaseAdapter } from './base.js';

export class ClaudeAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = 'claude';
    this.binaryName = 'claude';
  }

  buildArgs(prompt, sessionId, options = {}) {
    const args = [
      '-p', prompt,
      '--session-id', sessionId,
      '--output-format', this.config.outputFormat || 'stream-json',
      '--verbose',
      '--max-turns', String(options.maxTurns || this.config.maxTurns || 5)
    ];

    const model = options.model || (this.config.autoModel ? null : this.config.model);
    if (model) {
      args.push('--model', model);
    }

    const tools = options.allowedTools || this.config.allowedTools;
    if (tools && tools.length > 0) {
      args.push('--allowedTools', tools.join(','));
    }

    return args;
  }

  parseStreamLine(line) {
    try {
      const parsed = JSON.parse(line);

      if (parsed.type === 'assistant' && parsed.message?.content) {
        const textParts = parsed.message.content
          .filter(c => c.type === 'text')
          .map(c => c.text);
        return textParts.length > 0 ? textParts.join('') : null;
      }

      if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
        return parsed.delta.text;
      }

      if (parsed.type === 'result' && parsed.result) {
        return parsed.result;
      }

      return null;
    } catch {
      return null;
    }
  }

  async invoke(prompt, sessionId, options = {}) {
    const args = this.buildArgs(prompt, sessionId, options);

    return new Promise((resolve, reject) => {
      const chunks = [];
      let settled = false;
      const child = spawn(this.binaryName, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      let stderr = '';

      child.stdout.on('data', (data) => {
        const lines = data.toString().split('\n').filter(Boolean);
        for (const line of lines) {
          const text = this.parseStreamLine(line);
          if (text) {
            chunks.push(text);
            if (options.onChunk) options.onChunk(text);
          }
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0 && chunks.length === 0) {
          reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
        } else {
          resolve(chunks.join(''));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new Error(`Failed to spawn claude: ${err.message}`));
      });

      const timeout = options.timeout || 120000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error('Claude CLI timed out'));
      }, timeout);
    });
  }

  async install() {
    const { execSync } = await import('node:child_process');
    execSync('npm install -g @anthropic-ai/claude-code', { stdio: 'inherit' });
  }
}
