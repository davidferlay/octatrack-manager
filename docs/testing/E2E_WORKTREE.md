# E2E — correct worktree and dev server

Playwright serves the app from the **current working directory**. A dev server already
running on `:1420` from another worktree will serve **stale UI** and produce false failures.

## Recommended local run (PR #132 worktree)

```bash
cd "/Volumes/SunSSD 1T/Development/sandbox/masterocta-ui-workspace-foundation-1"
git rev-parse HEAD   # record SHA under test
CI=true pnpm run test:e2e
```

`CI=true` sets `reuseExistingServer` false (see `playwright.config.ts`) and starts a fresh
Vite dev server for this tree.

## Optional port override

```bash
PLAYWRIGHT_PORT=1421 CI=true pnpm run test:e2e
```

Use when `:1420` is occupied and you must not stop the other process.

## Reuse (explicit only)

```bash
PLAYWRIGHT_REUSE_SERVER=true PLAYWRIGHT_PORT=1420 pnpm run test:e2e
```

Only when you are certain the server on that port is built from **this** worktree.

## CI

GitHub Actions always starts a new server (`CI` set); port `1420`.
