import { jest } from '@jest/globals';
import { Scheduler } from '../../core/scheduler.js';
import { createBus } from '../../core/bus.js';

describe('Scheduler', () => {
  let bus, scheduler;

  beforeEach(() => {
    bus = createBus();
    scheduler = new Scheduler(bus, {
      enabled: true,
      persistPath: null
    });
  });

  afterEach(() => {
    scheduler.stopAll();
  });

  test('addReminder creates a reminder task', () => {
    const id = scheduler.addReminder({
      message: 'test reminder',
      channel: 'tui',
      schedule: null,
      delayMs: 100
    });
    expect(id).toBeDefined();
    expect(scheduler.tasks.has(id)).toBe(true);
  });

  test('addCron creates a cron task', () => {
    const id = scheduler.addCron({
      schedule: '* * * * *',
      command: '/vps df -h',
      channel: 'tui'
    });
    expect(id).toBeDefined();
    const task = scheduler.tasks.get(id);
    expect(task.type).toBe('cron');
  });

  test('addSmartTask creates a smart task', () => {
    const id = scheduler.addSmartTask({
      name: 'school-run',
      schedule: '30 7 * * 1-5',
      prompt: 'Check school arrival',
      channel: 'whatsapp',
      to: '628123',
      followUp: { interval: 600000, maxRetries: 3 }
    });
    expect(id).toBe('school-run');
    const task = scheduler.tasks.get(id);
    expect(task.type).toBe('smart');
  });

  test('enableTask and disableTask toggle task state', () => {
    const id = scheduler.addCron({
      schedule: '* * * * *',
      command: '/status',
      channel: 'tui'
    });
    scheduler.disableTask(id);
    expect(scheduler.tasks.get(id).enabled).toBe(false);
    scheduler.enableTask(id);
    expect(scheduler.tasks.get(id).enabled).toBe(true);
  });

  test('deleteTask removes task', () => {
    const id = scheduler.addReminder({
      message: 'delete me',
      channel: 'tui',
      delayMs: 99999
    });
    scheduler.deleteTask(id);
    expect(scheduler.tasks.has(id)).toBe(false);
  });

  test('listTasks returns all tasks', () => {
    scheduler.addReminder({ message: 'r1', channel: 'tui', delayMs: 99999 });
    scheduler.addCron({ schedule: '* * * * *', command: '/x', channel: 'tui' });
    expect(scheduler.listTasks().length).toBe(2);
  });

  test('one-off reminder fires and emits schedule:reminder', (done) => {
    bus.on('schedule:reminder', (data) => {
      expect(data.message).toBe('fire!');
      done();
    });
    scheduler.addReminder({
      message: 'fire!',
      channel: 'tui',
      delayMs: 50
    });
  });
});
