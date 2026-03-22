import { EventEmitter } from 'node:events';

export function createBus() {
  const bus = new EventEmitter();
  bus.setMaxListeners(20);

  bus.on('error', (err) => {
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${timestamp}] [bus] ERROR: ${message}`);
  });

  bus.emitError = (source, err) => {
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[${timestamp}] [${source}] ERROR:`, message);
    // Note: do not re-emit as 'error' to avoid double-logging
  };

  return bus;
}
