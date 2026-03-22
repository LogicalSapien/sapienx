import { toWhatsApp, toTui } from '../../channels/formatter.js';

describe('Formatter', () => {
  describe('toWhatsApp', () => {
    test('converts markdown bold to WhatsApp bold', () => {
      expect(toWhatsApp('**hello**')).toBe('*hello*');
    });

    test('converts markdown code blocks to monospace', () => {
      expect(toWhatsApp('`code`')).toBe('```code```');
    });

    test('strips markdown headers', () => {
      expect(toWhatsApp('## Header')).toBe('*Header*');
    });

    test('converts markdown links to text + url', () => {
      expect(toWhatsApp('[click](http://example.com)')).toBe('click (http://example.com)');
    });

    test('passes plain text through unchanged', () => {
      expect(toWhatsApp('hello world')).toBe('hello world');
    });

    test('converts fenced code blocks', () => {
      const input = '```js\nconst x = 1;\n```';
      expect(toWhatsApp(input)).toBe('```\nconst x = 1;\n```');
    });
  });

  describe('toTui', () => {
    test('passes text through (basic)', () => {
      expect(toTui('hello')).toBe('hello');
    });

    test('converts headers to bold ANSI', () => {
      const result = toTui('## Header');
      expect(result).toContain('\x1b[1m');
      expect(result).toContain('Header');
    });

    test('converts bold to ANSI bold', () => {
      const result = toTui('**bold text**');
      expect(result).toContain('\x1b[1m');
      expect(result).toContain('bold text');
    });
  });
});
