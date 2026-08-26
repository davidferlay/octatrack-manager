## Description

<!-- What does this PR do? Why is it needed? -->

## Observed

<!-- What is the current behavior? (for bug fixes) / What is missing? (for features) -->

## Expected

<!-- What should happen instead? / What should the feature do? -->

## Changes

<!-- List the key changes made in this PR -->

-

## Test Coverage

### Rust (`src-tauri/`)
- [ ] Unit tests added/updated for new or changed logic
- [ ] Fixture tests updated if project file handling changed
- [ ] `cargo test` passes (0 failures)
- [ ] `cargo fmt --check` clean
- [ ] `cargo clippy` clean (no new warnings)

### Frontend (`src/`)
- [ ] Vitest component/unit tests added/updated (`pnpm run test:frontend`)
- [ ] TypeScript type check clean (`pnpm run typecheck`)

### E2E (`e2e/`)
- [ ] Playwright tests added/updated for new UI behavior (`pnpm run test:e2e`)

## Documentation

- [ ] User guide updated (`user-guide/docs/` — see also `user-guide/CONTRIBUTING.md`)
- [ ] QA test cases updated (`qa/*-test-cases.md` — purely functional testing)

## Screenshots

<!-- For UI changes, include before/after screenshots -->

## Checklist

- [ ] All tests pass (`cargo test --workspace`, `pnpm run test`, `pnpm run test:e2e`)
- [ ] No linter or formatter issues (`cargo fmt`, `cargo clippy`, `pnpm run typecheck`)
- [ ] Commit messages are clear and descriptive
