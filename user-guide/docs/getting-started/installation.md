---
sidebar_position: 1
---

# Installation

Masta-Octa does not publish signed binary releases yet. Build Masta-Octa
from source instead of downloading an installer from the upstream project.

## Prerequisites

- Node.js 22.13.0 or newer
- Corepack, which installs the repository-pinned pnpm 11.24.0
- The Rust toolchain
- The platform prerequisites required to build a Tauri 2 application

## Build from source

Clone this fork and install the locked dependencies:

```bash
git clone https://github.com/kaz4g/masterocta.git
cd masterocta
corepack enable
pnpm install --frozen-lockfile
```

Start the application in development mode:

```bash
pnpm run tauri:dev
```

To create a local application bundle instead:

```bash
pnpm run tauri:build
```

The resulting bundle is a local build and is not a signed fork release.

## Verifying installation

Launch the application. You should see the **Home** screen with a
**Scan for Projects** button. If the application starts successfully, continue
to the [Quick Start](./quick-start.md) guide.

## Updating

The upstream automatic updater is intentionally disabled in this fork. The
version number in the header is informational and does not check for or install
updates.

To update a source checkout after reviewing the incoming changes, fast-forward
it and rebuild:

```bash
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm run tauri:build
```
