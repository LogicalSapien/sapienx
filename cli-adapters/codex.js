import { spawn } from 'node:child_process';
import { BaseAdapter } from './base.js';

export class CodexAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = 'codex';
    this.binaryName = 'codex';
  }

  buildArgs(prompt, sessionId, options = {}) {
    const args = [
      '-q', // quiet mode (no interactive UI)
      '--full-auto', // autonomous execution
      prompt
    ];

    const model = options.model || (this.config.autoModel ? null : this.config.model);
    if (model) {
      args.unshift('--model', model);
    }

    return args;
  }

  parseOutput(output) {
    // Codex outputs plain text (not stream-json like Claude)
    return output.trim();
  }

  async invoke(prompt, sessionId, options = {}) {
    const args = this.buildArgs(prompt, sessionId, options);

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let settled = false;

      const child = spawn(this.binaryName, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env }
      });

      child.stdout.on('data', (data) => {
        stdout += data.toString();
        if (options.onChunk) options.onChunk(data.toString());
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0 && !stdout.trim()) {
          const lowerErr = stderr.toLowerCase();
          const isAuthError = lowerErr.includes('login') || lowerErr.includes('auth') ||
            lowerErr.includes('token') || lowerErr.includes('expired') ||
            lowerErr.includes('unauthorized') || lowerErr.includes('api key');
          const isRateLimit = lowerErr.includes('rate') || lowerErr.includes('limit') ||
            lowerErr.includes('429') || lowerErr.includes('quota');
          const err = new Error(`Codex CLI exited with code ${code}: ${stderr}`);
          err.isAuthError = isAuthError;
          err.isRateLimit = isRateLimit;
          reject(err);
        } else {
          resolve(this.parseOutput(stdout));
        }
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(new Error(`Failed to spawn codex: ${err.message}`));
      });

      const timeout = options.timeout || 300000;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error('Codex CLI timed out'));
      }, timeout);
    });
  }

  async install() {
    const { execSync } = await import('node:child_process');
    execSync('npm install -g @openai/codex', { stdio: 'inherit' });
  }
}
