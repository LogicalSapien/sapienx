import { jest } from '@jest/globals';
import { Gateway } from '../../core/gateway.js';
import { createBus } from '../../core/bus.js';

describe('Gateway', () => {
  let bus, gateway;
  const ownerPhone = '6281234567890';

  beforeEach(() => {
    bus = createBus();
    gateway = new Gateway(bus, {
      owner: { phone: ownerPhone },
      groups: {}
    });
  });

  test('routes owner message to agent via message:routed', (done) => {
    bus.on('message:routed', (msg) => {
      expect(msg.text).toBe('hello');
      done();
    });
    bus.emit('message:incoming', {
      id: '1',
      channel: 'whatsapp',
      from: ownerPhone,
      text: 'hello',
      timestamp: Date.now()
    });
  });

  test('drops non-owner message with no pending reply', () => {
    const handler = jest.fn();
    bus.on('message:routed', handler);
    bus.emit('message:incoming', {
      id: '2',
      channel: 'whatsapp',
      from: '999999',
      text: 'hello',
      timestamp: Date.now()
    });
    // Give it a tick to process
    setTimeout(() => {
      expect(handler).not.toHaveBeenCalled();
    }, 50);
  });

  test('routes non-owner message if pending reply matches', (done) => {
    gateway.registerPendingReply({
      taskId: 'school-run',
      channel: 'whatsapp',
      expectedFrom: '628999',
      expiresAt: Date.now() + 60000
    });

    bus.on('task:reply', (data) => {
      expect(data.taskId).toBe('school-run');
      expect(data.message.text).toBe('arrived');
      done();
    });

    bus.emit('message:incoming', {
      id: '3',
      channel: 'whatsapp',
      from: '628999',
      text: 'arrived',
      timestamp: Date.now()
    });
  });

  test('cleans up expired pending replies', () => {
    gateway.registerPendingReply({
      taskId: 'old-task',
      channel: 'whatsapp',
      expectedFrom: '628999',
      expiresAt: Date.now() - 1000
    });
    gateway.cleanupExpiredReplies();
    expect(gateway.pendingReplies.size).toBe(0);
  });

  test('processes TUI messages without owner check', (done) => {
    bus.on('message:routed', (msg) => {
      expect(msg.text).toBe('tui message');
      done();
    });
    bus.emit('message:incoming', {
      id: '4',
      channel: 'tui',
      from: 'tui',
      text: 'tui message',
      timestamp: Date.now()
    });
  });

  test('processes messages serially (FIFO)', async () => {
    const order = [];

    bus.on('message:routed', (msg) => {
      order.push(msg.text);
    });

    bus.emit('message:incoming', {
      id: '5', channel: 'tui', from: 'tui',
      text: 'first', timestamp: Date.now()
    });
    bus.emit('message:incoming', {
      id: '6', channel: 'tui', from: 'tui',
      text: 'second', timestamp: Date.now()
    });

    await new Promise(r => setTimeout(r, 50));
    expect(order).toEqual(['first', 'second']);
  });

  test('routes enabled group messages', (done) => {
    const gw = new Gateway(bus, {
      owner: { phone: ownerPhone },
      groups: {
        'group123@g.us': { enabled: true, name: 'Test Group' }
      }
    });

    bus.on('message:routed', (msg) => {
      expect(msg.text).toBe('group msg');
      done();
    });

    bus.emit('message:incoming', {
      id: '7',
      channel: 'whatsapp',
      from: ownerPhone,
      text: 'group msg',
      timestamp: Date.now(),
      metadata: { isGroup: true, groupId: 'group123@g.us' }
    });
  });

  test('drops disabled group messages', () => {
    const handler = jest.fn();
    bus.on('message:routed', handler);
    bus.emit('message:incoming', {
      id: '8',
      channel: 'whatsapp',
      from: ownerPhone,
      text: 'group msg',
      timestamp: Date.now(),
      metadata: { isGroup: true, groupId: 'unknown-group@g.us' }
    });
    setTimeout(() => {
      expect(handler).not.toHaveBeenCalled();
    }, 50);
  });
});
