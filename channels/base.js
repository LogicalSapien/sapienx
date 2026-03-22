export class BaseChannel {
  constructor(bus, config) {
    if (new.target === BaseChannel) {
      throw new Error('BaseChannel is abstract — use a subclass');
    }
    this.bus = bus;
    this.config = config;
    this.name = 'base';
  }

  async start() {
    throw new Error('start() must be implemented by subclass');
  }

  async stop() {
    throw new Error('stop() must be implemented by subclass');
  }

  async send(message) {
    throw new Error('send() must be implemented by subclass');
  }
}
