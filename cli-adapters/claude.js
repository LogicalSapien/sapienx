import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { BaseAdapter } from './base.js';

export class ClaudeAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.name = 'claude';
    this.binaryName = 'claude';
  }

  buildArgs(prompt, sessionId, options = {}) {
    // Fresh UUID per invocation — avoids "session already in use" locks.
    // Conversation context is included in the prompt itself via message buffer.
    const cliSessionId = randomUUID();
    const args = [
      '-p', prompt,
      '--session-id', cliSessionId,
      '--output-format', this.config.outputFormat || 'stream-json',
      '--verbose',
      '--dangerously-skip-permissions',
      '--max-turns', String(options.maxTurns || this.config.maxTurns || 10)
    ];

    const model = options.model || (this.config.autoModel ? null : this.config.model);
    if (model) {
      args.push('--model', model);
    }

    // No --allowedTools restriction — give Claude full tool access
    // With --dangerously-skip-permissions, Claude can use Bash, Read, Write,
    // Edit, WebSearch, WebFetch, Glob, Grep, and everything else without asking

    return args;
  }

  parseStreamLine(line) {
    try {
      const parsed = JSON.parse(line);

      // Use only the result message — contains the final complete text.
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
          const lowerErr = stderr.toLowerCase();
          const isAuthError = lowerErr.includes('login') || lowerErr.includes('auth') ||
            lowerErr.includes('token') || lowerErr.includes('expired') ||
            lowerErr.includes('unauthorized') || lowerErr.includes('403');
          const err = new Error(`Claude CLI exited with code ${code}: ${stderr}`);
          err.isAuthError = isAuthError;
          reject(err);
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

      // Longer timeout — agentic tasks can take time
      const timeout = options.timeout || 300000; // 5 minutes
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
