import { jest } from '@jest/globals';
import { ClaudeAdapter } from '../../cli-adapters/claude.js';
import { BaseAdapter } from '../../cli-adapters/base.js';

describe('BaseAdapter', () => {
  test('cannot be instantiated directly', () => {
    expect(() => new BaseAdapter({})).toThrow('abstract');
  });
});

describe('ClaudeAdapter', () => {
  let adapter;

  beforeEach(() => {
    adapter = new ClaudeAdapter({
      model: 'sonnet',
      autoModel: false,
      maxTurns: 10,
      outputFormat: 'stream-json'
    });
  });

  test('extends BaseAdapter', () => {
    expect(adapter).toBeInstanceOf(BaseAdapter);
  });

  test('buildArgs constructs correct CLI arguments', () => {
    const args = adapter.buildArgs('hello', 'session-1', {});
    expect(args).toContain('-p');
    expect(args).toContain('--session-id');
    const sessionIdIndex = args.indexOf('--session-id') + 1;
    expect(args[sessionIdIndex]).toMatch(/^[0-9a-f-]{36}$/);
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--verbose');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--model');
    expect(args).toContain('sonnet');
    expect(args).toContain('--max-turns');
    expect(args).toContain('10');
  });

  test('buildArgs does not include --allowedTools (full access)', () => {
    const args = adapter.buildArgs('hello', 'session-1', {});
    expect(args).not.toContain('--allowedTools');
  });

  test('buildArgs omits --model when autoModel is true', () => {
    adapter.config.autoModel = true;
    const args = adapter.buildArgs('hello', 'session-1', {});
    expect(args).not.toContain('--model');
  });

  test('buildArgs allows model override', () => {
    const args = adapter.buildArgs('hello', 'session-1', { model: 'opus' });
    expect(args).toContain('opus');
  });

  test('parseStreamLine extracts result text', () => {
    const line = JSON.stringify({ type: 'result', result: 'Hello!' });
    const result = adapter.parseStreamLine(line);
    expect(result).toBe('Hello!');
  });

  test('parseStreamLine skips assistant messages to avoid duplicates', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello!' }] }
    });
    const result = adapter.parseStreamLine(line);
    expect(result).toBeNull();
  });

  test('parseStreamLine returns null for non-result types', () => {
    const line = JSON.stringify({ type: 'system', data: {} });
    const result = adapter.parseStreamLine(line);
    expect(result).toBeNull();
  });

  test('parseStreamLine handles malformed JSON gracefully', () => {
    const result = adapter.parseStreamLine('not json');
    expect(result).toBeNull();
  });
});
