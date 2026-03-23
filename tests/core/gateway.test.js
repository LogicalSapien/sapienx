import { jest } from '@jest/globals';
import { Gateway } from '../../core/gateway.js';
import { createBus } from '../../core/bus.js';

describe('Gateway', () => {
  let bus, gateway;
  const ownerPhone = '6281234567890';

  beforeEach(() => {
    bus = createBus();
    gateway = new Gateway(bus, {
      owner: { phone: ownerPhone, allowedNumbers: ['628111222333'] },
      groups: {},
      groupPolicy: 'ignore',
      allowedGroups: []
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

  test('routes allowed number message', (done) => {
    bus.on('message:routed', (msg) => {
      expect(msg.text).toBe('from allowed');
      done();
    });
    bus.emit('message:incoming', {
      id: '2',
      channel: 'whatsapp',
      from: '628111222333',
      text: 'from allowed',
      timestamp: Date.now()
    });
  });

  test('drops non-allowed message with no pending reply', () => {
    const handler = jest.fn();
    bus.on('message:routed', handler);
    bus.emit('message:incoming', {
      id: '3',
      channel: 'whatsapp',
      from: '999999',
      text: 'hello',
      timestamp: Date.now()
    });
    setTimeout(() => {
      expect(handler).not.toHaveBeenCalled();
    }, 50);
  });

  test('routes self-chat messages', (done) => {
    bus.on('message:routed', (msg) => {
      expect(msg.text).toBe('self chat');
      done();
    });
    bus.emit('message:incoming', {
      id: '4',
      channel: 'whatsapp',
      from: ownerPhone,
      text: 'self chat',
      timestamp: Date.now(),
      metadata: { isSelfChat: true }
    });
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
      id: '5',
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
      id: '6',
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
      id: '7', channel: 'tui', from: 'tui',
      text: 'first', timestamp: Date.now()
    });
    bus.emit('message:incoming', {
      id: '8', channel: 'tui', from: 'tui',
      text: 'second', timestamp: Date.now()
    });
    await new Promise(r => setTimeout(r, 50));
    expect(order).toEqual(['first', 'second']);
  });

  // Group policy tests
  test('ignores group messages when policy is ignore', () => {
    const handler = jest.fn();
    bus.on('message:routed', handler);
    bus.emit('message:incoming', {
      id: '9',
      channel: 'whatsapp',
      from: ownerPhone,
      text: 'group msg',
      timestamp: Date.now(),
      metadata: { isGroup: true, groupId: 'group123@g.us' }
    });
    setTimeout(() => {
      expect(handler).not.toHaveBeenCalled();
    }, 50);
  });

  test('routes group messages when policy is all', (done) => {
    const gw = new Gateway(bus, {
      owner: { phone: ownerPhone, allowedNumbers: [] },
      groups: {},
      groupPolicy: 'all',
      allowedGroups: []
    });

    bus.on('message:routed', (msg) => {
      expect(msg.text).toBe('group msg');
      done();
    });

    bus.emit('message:incoming', {
      id: '10',
      channel: 'whatsapp',
      from: ownerPhone,
      text: 'group msg',
      timestamp: Date.now(),
      metadata: { isGroup: true, groupId: 'any-group@g.us' }
    });
  });

  test('routes allowlisted group messages', (done) => {
    const gw = new Gateway(bus, {
      owner: { phone: ownerPhone, allowedNumbers: [] },
      groups: {},
      groupPolicy: 'allowlist',
      allowedGroups: ['group123@g.us']
    });

    bus.on('message:routed', (msg) => {
      expect(msg.text).toBe('allowed group');
      done();
    });

    bus.emit('message:incoming', {
      id: '11',
      channel: 'whatsapp',
      from: ownerPhone,
      text: 'allowed group',
      timestamp: Date.now(),
      metadata: { isGroup: true, groupId: 'group123@g.us' }
    });
  });

  test('drops non-allowlisted group messages', () => {
    const gw = new Gateway(bus, {
      owner: { phone: ownerPhone, allowedNumbers: [] },
      groups: {},
      groupPolicy: 'allowlist',
      allowedGroups: ['group123@g.us']
    });

    const handler = jest.fn();
    bus.on('message:routed', handler);
    bus.emit('message:incoming', {
      id: '12',
      channel: 'whatsapp',
      from: ownerPhone,
      text: 'blocked group',
      timestamp: Date.now(),
      metadata: { isGroup: true, groupId: 'other-group@g.us' }
    });
    setTimeout(() => {
      expect(handler).not.toHaveBeenCalled();
    }, 50);
  });
});
