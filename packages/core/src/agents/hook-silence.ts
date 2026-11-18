import { closeSync, existsSync, fstatSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { reverseLines } from './jsonl-titles.js';
import { agentRoot } from './roots.js';

/** How far back from the end of a transcript to look for the latest prompt. */
const TAIL_BYTES = 512 * 1024;
/** A prompt this recent may still be on its way through the hooks. */
const SETTLE_MS = 2 * 60_000;

/**
 * The subtitle a prompt hook reports (spec §4.2): the prompt's first real line.
 * Text the agent injects itself (`<task-notification>`, `<command-name>`…) is not the
 * user's, and attachment placeholders such as `[Image #3]` say nothing about the topic.
 */
export function promptTopic(prompt: string): string | undefined {
  if (/^\s*<[a-z][\w-]*[\s>]/i.test(prompt)) return undefined;
  const first = prompt
    .split('\n')
    .map((l) => l.replace(/\[(Image|Pasted text) #\d+[^\]]*\]/g, '').replace(/\s+/g, ' ').trim())
    .find(Boolean);
  return first ? first.slice(0, 120) : undefined;
}

/** The latest user prompt in a Claude Code transcript, read from its tail only. */
export function lastClaudePrompt(file: string): { at: string; topic: string } | undefined {
  return lastClaudePrompts(file, 1)[0];
}

/** Up to `count` latest user prompts, newest first, read from the tail only. */
export function lastClaudePrompts(file: string, count: number): { at: string; topic: string }[] {
  const prompts: { at: string; topic: string }[] = [];
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    let read = 0;
    for (const line of reverseLines(fd, fstatSync(fd).size, (bytes) => { read += bytes; })) {
      if (read > TAIL_BYTES) break;
      if (!line.includes('"type":"user"') && !line.includes('"queued_command"')) continue;
      type Origin = { origin?: { kind?: unknown } };
      let entry: Origin & { type?: unknown; timestamp?: unknown; message?: { content?: unknown };
        attachment?: Origin & { type?: unknown; prompt?: unknown; commandMode?: unknown };
        isCompactSummary?: unknown; isVisibleInTranscriptOnly?: unknown; isSidechain?: unknown; isMeta?: unknown };
      try { entry = JSON.parse(line); } catch { continue; }
      // Summaries, subagent turns and meta records are the agent's own, not prompts its hooks report.
      if (entry.isCompactSummary || entry.isVisibleInTranscriptOnly || entry.isSidechain || entry.isMeta) continue;
      // Only what a person typed counts; messages from other agent sessions carry no human origin.
      // A message sent while the agent works is recorded as a queued command.
      const queued = entry.type === 'attachment' && entry.attachment?.type === 'queued_command'
        && (entry.attachment.commandMode ?? 'prompt') === 'prompt' && entry.attachment.origin?.kind === 'human' ? entry.attachment.prompt : undefined;
      const content = entry.type === 'user' && entry.origin?.kind === 'human' ? entry.message?.content : queued;
      if (typeof content !== 'string' || typeof entry.timestamp !== 'string') continue;
      const topic = promptTopic(content);
      if (topic) prompts.push({ at: entry.timestamp, topic });
      if (prompts.length === count) break;
    }
    return prompts;
  } catch {
    return []; // Transcripts are optional and may rotate while being read.
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * Whether a live Claude Code session's hooks have stopped reporting: its transcript
 * holds a settled prompt the hooks never reported as the subtitle (spec §4.2).
 */
export function claudeHooksSilent(cwd: string, conversation: string, topic: string, env: NodeJS.ProcessEnv, now = Date.now()): boolean {
  if (!/^[a-zA-Z0-9_-]+$/.test(conversation)) return false;
  const root = agentRoot('claude', env);
  for (const encoded of new Set([cwd.replace(/[^A-Za-z0-9]/g, '-'), cwd.replace(/\//g, '-')])) {
    const file = join(root, 'projects', encoded, `${conversation}.jsonl`);
    if (!existsSync(file)) continue;
    const [latest, previous] = lastClaudePrompts(file, 2);
    if (!latest || latest.topic === topic) return false;
    const settled = (prompt?: { at: string }) => !!prompt && now - Date.parse(prompt.at) > SETTLE_MS;
    // A prompt just sent may still be on its way; then the one before it must have been reported.
    return settled(latest) || (settled(previous) && previous!.topic !== topic);
  }
  return false;
}
