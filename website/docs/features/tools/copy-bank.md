---
sidebar_position: 2
---

# Copy Bank

:::caution In Development — Coming Soon
The **Copy Bank** feature is a work in progress and is not yet considered stable.
:::

The planned **Copy Bank** tool allows you to copy an entire bank—including all 16 patterns and all 4 parts—from one project to another. This is intended to simplify merging live sets or reordering banks across your project list.

![Tools - Copy Bank](/img/screenshots/tools-copy-bank.png)

## Current Workflow (Experimental)

1. **Source Bank:** Select the bank (A–P) to copy from the current project.
2. **Destination Project:** Choose the project where the bank will be copied.
3. **Destination Banks:** Choose one or more destination banks (A–P) to receive the data.
4. **Execute:** Perform the bulk copy.

---

## Planned Data Coverage

When stable, copying a bank is expected to include:

- **16 Patterns:** Sequences, triggers, parameter locks, and micro-timing.
- **4 Parts:** Machine settings, amplifier configuration, LFOs, and effects.
- **Part Assignments:** Pattern links to their respective parts.
- **Track Settings:** Swing, quantization, and other per-track parameters.

---

## Important Safety Notes

- **Destructive Operation:** Copying a bank replaces any existing data at the destination.
- **Backup Mandatory:** Because this is an experimental feature, **always back up your project** before executing a bank copy.
- **Sample Slots:** This tool is designed to copy slot **references** only. It does not move the underlying audio files.
