import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.PLAYWRIGHT_PORT ?? 1420)
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Keep CI parallelism conservative while avoiding a 420-test serial queue.
  workers: process.env.CI ? 2 : undefined,
  reporter: 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit-layout',
      testMatch: /inspector-layout-stability\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
  webServer: {
    command: `pnpm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer,
    timeout: 120000,
  },
})
