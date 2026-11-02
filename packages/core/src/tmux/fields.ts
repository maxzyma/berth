import { BerthError } from '../errors.js';

const SEPARATOR = '~';
const escapeEntries = ['=', '\n', '\r', '\t', '\x1f', SEPARATOR].map((character) =>
  [character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'), character] as const);
const escapes: Readonly<Record<string, string>> = Object.fromEntries(escapeEntries);

/** Encode before framing. Nested substitutions also work on tmux 3.0,
 * whose chained modifiers retain only the last substitution. */
export function formatFields(keys: readonly string[]): string {
  return keys.map((key) => escapeEntries.reduce((inner, [code, character]) =>
    `#{s|${character}|=${code}|:?pid,${inner},}`, `#{${key}}`)).join(SEPARATOR);
}

/** Decode once so escape-looking source text stays literal. */
export function readFields(output: string, count: number): string[][] {
  return output.split('\n').filter((line) => line.length > 0).map((line) => {
    const fields = line.split(SEPARATOR);
    if (fields.length !== count) throw new BerthError('Malformed tmux record; refusing to infer session identity.');
    return fields.map((value) => value.replace(/=([0-9A-F]{2})/g, (match, code: string) => escapes[code] ?? match));
  });
}

/** Quote literal data embedded in a tmux format, separately from shell quoting. */
export function formatLiteral(value: string): string {
  return value.replaceAll("#", "##");
}
