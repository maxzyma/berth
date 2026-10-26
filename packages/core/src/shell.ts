/** Minimal POSIX shell word handling for launch commands. */

const SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

export function shellQuote(word: string): string {
  if (word === '') return "''";
  if (SAFE.test(word)) return word;
  return `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Split a command line into words: honours single quotes, double quotes and backslashes. */
export function shellSplit(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let inWord = false;
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < line.length && '"\\$`'.includes(line[i + 1])) current += line[++i];
      else current += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === '\\' && i + 1 < line.length) {
      current += line[++i];
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (inWord) words.push(current);
      current = '';
      inWord = false;
    } else {
      current += ch;
      inWord = true;
    }
  }
  if (quote) throw new Error(`unterminated quote in: ${line}`);
  if (inWord) words.push(current);
  return words;
}

/** Fill `{key}` placeholders; values are shell-quoted, `{args}` is inserted as already-quoted words. */
export function renderTemplate(template: string, values: Record<string, string>): string {
  return template
    .replace(/\{(\w+)\}/g, (match, key: string) => {
      if (!(key in values)) return match;
      return key === 'args' ? values[key] : shellQuote(values[key]);
    })
    .replace(/\s+$/, '');
}
