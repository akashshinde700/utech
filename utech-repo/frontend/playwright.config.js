import { defineConfig } from '@playwright/test';
import chromiumPkg from '@sparticuz/chromium';

process.env.VERCEL = '1';
const executablePath = await chromiumPkg.executablePath();

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    headless: true,
    launchOptions: {
      executablePath,
      args: chromiumPkg.args,
    },
  },
});
