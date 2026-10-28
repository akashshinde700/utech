import { defineConfig } from '@playwright/test';
import chromiumPkg from '@sparticuz/chromium';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.VERCEL = '1';
// @sparticuz/chromium ships a Linux/Lambda build. On a developer machine or a
// CI runner that already has a browser, point at that one instead:
//   E2E_CHROME_PATH="C:\Program Files\Google\Chrome\Application\chrome.exe"
// Without it nothing changes — the Lambda binary is still used.
const localBrowser = process.env.E2E_CHROME_PATH || '';
const executablePath = localBrowser || (await chromiumPkg.executablePath());
const useDemo = process.env.E2E_USE_DEMO === '1';
if (!useDemo && process.env.E2E_CONFIRM_DISPOSABLE !== '1') {
  throw new Error('Playwright tests modify data. Use npm run test:e2e or explicitly confirm a disposable external environment.');
}
const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(frontendDir, '../backend');

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // Isolated disposable servers: the workflow tests create and change records.
  // The regular live preview on ports 4000/5173 is never touched.
  webServer: useDemo ? [
    {
      command: 'node src/server.js', cwd: backendDir,
      env: { ...process.env, USE_IN_MEMORY_DB: '1', NODE_ENV: 'test', PORT: '4101', COMPANY_STATE_CODE: '27' },
      url: 'http://127.0.0.1:4101/health', reuseExistingServer: false, timeout: 60000,
    },
    {
      command: 'npm run dev -- --host 0.0.0.0 --port 5183 --strictPort', cwd: frontendDir,
      env: { ...process.env, API_PROXY_TARGET: 'http://127.0.0.1:4101' },
      url: 'http://127.0.0.1:5183', reuseExistingServer: false, timeout: 60000,
    },
  ] : undefined,
  use: {
    baseURL: useDemo ? 'http://127.0.0.1:5183' : (process.env.E2E_BASE_URL || 'http://localhost:5173'),
    viewport: { width: 1440, height: 900 },
    actionTimeout: 10000,
    headless: true,
    // Avoid timing-sensitive CSS transforms in headless actionability checks;
    // the app also honors this accessibility preference for real users.
    reducedMotion: 'reduce',
    launchOptions: {
      executablePath,
      // The Lambda single-process flags can hang the headless renderer after
      // modal/navigation workflows in a long-lived Linux test session. A local
      // browser needs none of those flags at all.
      args: localBrowser
        ? []
        : chromiumPkg.args.filter((arg) => !['--single-process', '--no-zygote', '--in-process-gpu'].includes(arg)),
    },
  },
});
