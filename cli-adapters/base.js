import { execSync } from 'node:child_process';

export class BaseAdapter {
  constructor(config) {
    if (new.target === BaseAdapter) {
      throw new Error('BaseAdapter is abstract — use a subclass');
    }
    this.config = config;
    this.name = 'base';
  }

  async invoke(prompt, sessionId, options = {}) {
    throw new Error('invoke() must be implemented by subclass');
  }

  isAvailable() {
    try {
      execSync(`which ${this.binaryName}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  async install() {
    throw new Error('install() must be implemented by subclass');
  }
}
