import { jest } from '@jest/globals';
import { createBus } from '../../core/bus.js';

describe('Event Bus', () => {
  let bus;

  beforeEach(() => {
    bus = createBus();
  });

  test('emits and receives events', () => {
    const handler = jest.fn();
    bus.on('test:event', handler);
    bus.emit('test:event', { data: 'hello' });
    expect(handler).toHaveBeenCalledWith({ data: 'hello' });
  });

  test('has default error handler that does not crash', () => {
    expect(() => {
      bus.emit('error', new Error('test error'));
    }).not.toThrow();
  });

  test('maxListeners is set to 20', () => {
    expect(bus.getMaxListeners()).toBe(20);
  });

  test('error handler logs to stderr', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    bus.emit('error', new Error('test error'));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('emitError helper includes source component', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    bus.emitError('gateway', new Error('route failed'));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[gateway]'),
      expect.any(String)
    );
    spy.mockRestore();
  });
});
