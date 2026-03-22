import { exec } from 'node:child_process';

const DEFAULT_TIMEOUT = 30000;
const MAX_OUTPUT = 10240;

export default async function handler(input, context) {
  const { text, config } = context;
  const timeout = config?.vps?.commandTimeout || DEFAULT_TIMEOUT;
  const destructiveKeywords = config?.skills?.destructiveKeywords || [
    'rm', 'kill', 'reboot', 'shutdown', 'drop', 'mkfs', 'dd', 'format'
  ];

  // Extract command from message
  let command = text;
  const prefixes = ['/vps ', 'run ', 'execute ', 'shell '];
  for (const prefix of prefixes) {
    if (text.toLowerCase().startsWith(prefix)) {
      command = text.slice(prefix.length).trim();
      break;
    }
  }

  if (!command) {
    return 'No command specified. Usage: /vps <command>';
  }

  // Check for destructive keywords
  const words = command.toLowerCase().split(/\s+/);
  const isDestructive = destructiveKeywords.some(kw =>
    words.some(w => w === kw || w.endsWith('/' + kw))
  );

  if (isDestructive) {
    if (!context.confirmed) {
      return `WARNING: Destructive command detected: \`${command}\`\nReply "yes" to confirm execution.`;
    }
  }

  return new Promise((resolve) => {
    exec(command, { timeout, maxBuffer: MAX_OUTPUT }, (error, stdout, stderr) => {
      let result = '';
      if (stdout) result += stdout;
      if (stderr) result += (result ? '\n' : '') + stderr;
      if (error && !result) {
        result = `Error: ${error.message}`;
      }
      if (result.length > MAX_OUTPUT) {
        result = result.slice(0, MAX_OUTPUT) + '\n... (truncated)';
      }
      resolve(result || '(no output)');
    });
  });
}
