import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/ui', workers: 1, fullyParallel: false,
  timeout: 30000,
  outputDir: 'test-results',
  reporter: [['list'], ['json', { outputFile: process.env.BASELINE === '1' ? 'docs/test-evidence/baseline-results.json' : 'docs/test-evidence/ui-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'chrome', headless: true, serviceWorkers: 'block', viewport: { width: 390, height: 844 }, screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/support/server.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
