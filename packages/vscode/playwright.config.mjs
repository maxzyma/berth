import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export default defineConfig({
  testDir: './test/browser',
  outputDir: process.env.BERTH_REVIEW_OUTPUT || join(tmpdir(), 'berth-webview-review'),
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { channel: 'chrome', headless: true, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: '1440x900', use: { viewport: { width: 1440, height: 900 } } },
    { name: '1280x800', use: { viewport: { width: 1280, height: 800 } } },
  ],
});
