#!/usr/bin/env node
// Capture Berth's promotional screenshots and screen recording.
//
//   node scripts/demo/capture.mjs --vsix <berth.vsix> --out <directory>
//     [--tmp-base /tmp] [--vscode-app "/Applications/Visual Studio Code.app"]
//     [--only shots|video] [--keep]
//
// Requires macOS, VS Code, tmux, ffmpeg and the Claude Code CLI on PATH.
// Writes overview.png (1440x865), overview-1280.png (1280x765), details.png
// (1440x865, hover card) and session-tour.mp4 (1440x810, no audio) to --out.
//
// Everything runs below a new temporary root: its own HOME, tmux socket
// directory, Claude Code profile, VS Code user-data and extensions. Claude
// Code talks to a synthetic model on 127.0.0.1 (model-server.mjs); no
// credentials or model calls are used. VS Code starts in the background
// (open -g) and is driven only through a loopback DevTools port, so it never
// takes keyboard or mouse focus. The script aborts if the caller's own tmux
// server hooks change. --keep leaves the environment running until Ctrl-C.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DemoEnvironment, callerTmuxFingerprint, which } from './environment.mjs';
import { Workbench } from './workbench.mjs';
import { LIVE_PROMPT, SESSIONS } from './scene.mjs';

const sleep = ms => new Promise(done => setTimeout(done, ms));
const log = line => process.stdout.write(`[demo] ${line}\n`);

const { values: args } = parseArgs({
  options: {
    vsix: { type: 'string' },
    out: { type: 'string' },
    'tmp-base': { type: 'string', default: '/tmp' },
    'vscode-app': { type: 'string', default: '/Applications/Visual Studio Code.app' },
    only: { type: 'string' },
    keep: { type: 'boolean', default: false },
  },
});
if (!args.vsix || !args.out) {
  process.stderr.write('Usage: node scripts/demo/capture.mjs --vsix <berth.vsix> --out <directory> [--tmp-base DIR] [--vscode-app APP] [--only shots|video] [--keep]\n');
  process.exit(2);
}
if (process.platform !== 'darwin') throw new Error('The capture script drives VS Code through macOS LaunchServices.');
const out = resolve(args.out);
mkdirSync(out, { recursive: true });
const ffmpeg = which('ffmpeg');

const callerFingerprint = callerTmuxFingerprint();
function guardCaller(stage) {
  if (callerTmuxFingerprint() !== callerFingerprint) throw new Error(`The caller's tmux server hooks changed during ${stage}; stopping.`);
}

/**
 * Click the first of `buttons` shown in a notification, looking in the toasts
 * and then in the notification centre. Resolves with the clicked label.
 */
async function answerNotification(wb, buttons, { timeoutMs = 60000 } = {}) {
  const find = async () => {
    for (const button of buttons) {
      const found = await wb.center('.notification-list-item .monaco-button', button, { timeoutMs: 700 }).catch(() => null);
      if (found) return { button, ...found };
    }
    return null;
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    let found = await find();
    if (!found) {
      await wb.command('Notifications: Show Notifications');
      found = await find();
      if (!found) await wb.key('Escape');
    }
    if (found) {
      await wb.click(found.x, found.y);
      return found.button;
    }
    await sleep(1000);
  }
  return undefined;
}

function sessionOption(env, name, option) {
  try { return env.tmux('show-options', '-qv', '-t', name, option).trim(); } catch { return ''; }
}

async function waitForState(env, names, state, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (names.every(name => sessionOption(env, name, '@berth_state') === state)) return;
    await sleep(150);
  }
  throw new Error(`Sessions ${names.join(', ')} did not reach ${state}.`);
}

async function installHooks(env, wb) {
  await wb.command('Berth: Focus on Sessions View');
  await wb.sessionRow(SESSIONS[0].name, { timeoutMs: 60000 });
  // Berth first offers its layout (kept as is: the layout settings are preset),
  // then its hooks.
  for (;;) {
    const answered = await answerNotification(wb, ['Keep Current Layout', 'Set Up…']);
    if (!answered) throw new Error('Berth did not offer its hooks.');
    log(`answered "${answered}"`);
    if (answered === 'Set Up…') break;
  }
  await wb.waitFor(`[...document.querySelectorAll('.quick-input-widget .monaco-button')].some(b => b.textContent.trim() === 'OK' && b.getBoundingClientRect().width > 0)`, { label: 'hook picker' });
  await wb.clickElement('.quick-input-widget .monaco-button', 'OK');
  const settings = join(env.dirs.claudeConfig, 'settings.json');
  const deadline = Date.now() + 30000;
  while (!(readFileSync(settings, 'utf8').includes('UserPromptSubmit') && env.tmux('show-hooks', '-g').includes('[97]'))) {
    if (Date.now() > deadline) throw new Error('Berth hooks were not installed in the demo profile.');
    await sleep(200);
  }
  guardCaller('hook installation');
  log('installed Claude Code and tmux hooks in the demo profile');
  await wb.command('Notifications: Clear All Notifications');
}

/** Restart each agent with its prompt so the new hooks record topic and state. */
async function runPrompts(env) {
  for (const session of SESSIONS) env.restartSession(session);
  await sleep(1000);
  await waitForState(env, SESSIONS.map(s => s.name), 'done');
  log('all sessions answered');
}

/** Sessions on the left at 375 px, Explorer on the right at 190 px (the Berth layout). */
async function arrangeLayout(wb, width) {
  await wb.command('View: Show Explorer');
  const sashes = async () => wb.evaluate(`[...document.querySelectorAll('.monaco-sash.vertical')]
    .map(s => s.getBoundingClientRect()).filter(b => b.height > 300 && b.width > 0)
    .map(b => ({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) })).sort((a, b) => a.x - b.x)`);
  const [left] = await sashes();
  await wb.drag(left, { x: 379, y: left.y });
  const [, right] = await sashes();
  await wb.drag(right, { x: width - 240, y: right.y });
}

async function openSession(wb, name, durationMs = 0) {
  const row = await wb.sessionRow(name);
  await wb.click(row.x + 70, row.y + 12, durationMs);
  await wb.waitFor(`[...document.querySelectorAll('.tab.active .label-name')].some(l => l.textContent.trim().endsWith(${JSON.stringify(name)}))`, { label: `${name} terminal` });
}

async function captureShots(wb) {
  await wb.viewport(1440, 865);
  await wb.showPointer(false);
  await wb.movePointerTo(760, 600);
  await sleep(800);
  await wb.screenshot(join(out, 'overview.png'));
  const row = await wb.sessionRow('cart-tests');
  await wb.movePointerTo(row.x + 120, row.y + 14, 300);
  await wb.waitForDetails('cart-tests');
  await sleep(500);
  await wb.screenshot(join(out, 'details.png'));
  const close = await wb.viewElementCenter('.hover-close');
  if (close) await wb.click(close.x, close.y);
  await wb.movePointerTo(760, 600);
  await wb.waitForDetails(null);
  // Last: the agent's terminal redraws after a resize.
  await wb.viewport(1280, 765);
  await sleep(800);
  await wb.screenshot(join(out, 'overview-1280.png'));
}

async function assembleVideo(frames, end, file) {
  if (frames.length < 10) throw new Error(`The screencast produced only ${frames.length} frames.`);
  const list = frames.map((frame, i) => {
    const next = i + 1 < frames.length ? frames[i + 1].time : end;
    return `file '${frame.file}'\nduration ${Math.max(0.001, next - frame.time).toFixed(4)}`;
  });
  const listFile = `${frames[0].file}.txt`;
  writeFileSync(listFile, `${list.join('\n')}\nfile '${frames[frames.length - 1].file}'\n`);
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-vf', 'fps=30,scale=1440:810:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '16', '-preset', 'slow',
    '-movflags', '+faststart', '-an', file]);
  log(`wrote ${file} from ${frames.length} frames`);
}

async function recordTour(env, wb) {
  const { session: live, text: prompt } = LIVE_PROMPT;
  await wb.viewport(1440, 810);
  await wb.showPointer(true);
  await wb.movePointerTo(760, 560);
  await wb.startScreencast(env.dirs.frames, { width: 1440, height: 810 });
  await sleep(2000);
  // Browse a file next to the agent terminal.
  await wb.clickElement('.explorer-folders-view .monaco-list-row .label-name', 'shop-api', 900);
  await wb.center('.explorer-folders-view .monaco-list-row .label-name', 'cart.ts');
  await sleep(600);
  await wb.clickElement('.explorer-folders-view .monaco-list-row .label-name', 'cart.ts', 900);
  await wb.waitFor(`[...document.querySelectorAll('.tab .label-name')].some(l => l.textContent.trim() === 'cart.ts')`, { label: 'cart.ts editor' });
  await sleep(2800);
  // Find another session by name.
  await wb.clickElement('.part.auxiliarybar .title-actions .action-label[aria-label^="Find a Session"]', undefined, 900);
  await wb.waitFor(`!!document.querySelector('.quick-input-widget:not([style*="display: none"]) input')`, { label: 'Find a Session' });
  await sleep(700);
  await wb.type('quick', 140);
  await sleep(900);
  await wb.key('Enter');
  await wb.waitFor(`[...document.querySelectorAll('.tab.active .label-name')].some(l => l.textContent.trim().endsWith('quickstart'))`, { label: 'quickstart terminal' });
  await sleep(3000);
  // Hover another session for its details, then open it.
  const row = await wb.sessionRow(live);
  await wb.movePointerTo(row.x + 110, row.y + 14, 900);
  await wb.waitForDetails(live);
  await sleep(2500);
  await openSession(wb, live, 300);
  await sleep(1500);
  // Ask the agent something and watch the session go from working to done.
  const terminal = await wb.center('.editor-instance .xterm-screen');
  await wb.click(terminal.x, terminal.y + 200, 700);
  await sleep(500);
  await wb.type(prompt, 55);
  await sleep(400);
  await wb.key('Enter');
  await waitForState(env, [live], 'working', 15000);
  log(`${live} is working`);
  await waitForState(env, [live], 'done', 60000);
  log(`${live} is done`);
  await sleep(3500);
  const { frames, end } = await wb.stopScreencast();
  await assembleVideo(frames, end, join(out, 'session-tour.mp4'));
}

const env = new DemoEnvironment({ tmpBase: resolve(args['tmp-base']), vsix: resolve(args.vsix), vscodeApp: args['vscode-app'], log });
let wb;
try {
  await env.create();
  for (const session of SESSIONS) env.startSession({ ...session, prompt: undefined });
  env.launchVsCode();
  wb = await Workbench.connect(env.debugPort, log);
  await wb.waitFor(`!!document.querySelector('.part.auxiliarybar')`, { label: 'workbench', timeoutMs: 60000 });
  env.verifyVsCodeEnvironment();
  await wb.viewport(1440, 865);
  await installHooks(env, wb);
  env.verifyVsCodeEnvironment();
  await runPrompts(env);
  await arrangeLayout(wb, 1440);
  await openSession(wb, 'cart-tests');
  await wb.waitFor(`[...document.querySelectorAll('.explorer-folders-view .label-name')].some(l => l.textContent.trim() === 'cart.ts')`, { label: 'Explorer follows the session' });
  guardCaller('setup');
  if (!args.only || args.only === 'shots') await captureShots(wb);
  if (!args.only || args.only === 'video') await recordTour(env, wb);
  guardCaller('capture');
  if (args.keep) {
    log(`environment kept at ${env.dirs.root} (debugging port ${env.debugPort}); press Ctrl-C to stop`);
    await new Promise(done => process.once('SIGINT', done));
  }
} catch (error) {
  process.exitCode = 1;
  log(`failed: ${error.stack ?? error}`);
  if (wb && env.dirs && existsSync(env.dirs.logs)) await wb.screenshot(join(env.dirs.logs, 'failure.png')).catch(() => {});
} finally {
  wb?.close();
  await env.shutdown({ keepRoot: process.exitCode === 1 || args.keep });
  guardCaller('shutdown');
  log('caller tmux server unchanged');
}
