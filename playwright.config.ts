import { defineConfig, devices } from '@playwright/test'

// The suite's own dev-server port. Overridable so two runs can go at once without
// fighting over it, and kept off 1420, which vite.config.ts pins for Tauri.
const PORT = process.env.PW_PORT ?? '1430'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // The suite owns its server, on its own port. Attaching to a long-running dev
    // server meant a restart mid-suite took tests down with it, as a burst of
    // connection refusals; 1430 keeps it clear of the Tauri dev port (1420, which
    // vite.config.ts pins with strictPort) so both can run at once.
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120000,
  },
})
