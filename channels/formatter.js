export function toWhatsApp(markdown) {
  let text = markdown;

  // Fenced code blocks: ```lang\ncode\n``` → ```\ncode\n```
  text = text.replace(/```\w*\n([\s\S]*?)```/g, '```\n$1```');

  // Headers: ## Header → *Header*
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Bold: **text** → *text*
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Inline code: `code` → ```code```
  text = text.replace(/(?<!`)`([^`]+)`(?!`)/g, '```$1```');

  // Links: [text](url) → text (url)
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  return text;
}

export function toTelegram(markdown) {
  // V2 — for now pass through
  return markdown;
}

export function toTui(markdown) {
  let text = markdown;
  // Fenced code blocks → dim
  text = text.replace(/```\w*\n([\s\S]*?)```/g, '\x1b[2m$1\x1b[0m');
  // Headers → bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '\x1b[1m$1\x1b[0m');
  // Bold → bold ANSI
  text = text.replace(/\*\*(.+?)\*\*/g, '\x1b[1m$1\x1b[0m');
  // Inline code → dim
  text = text.replace(/(?<!`)`([^`]+)`(?!`)/g, '\x1b[2m$1\x1b[0m');
  return text;
}
