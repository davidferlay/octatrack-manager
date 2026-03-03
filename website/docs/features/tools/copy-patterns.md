---
sidebar_position: 4
---

# Copy Pattern

:::caution In Development — Coming Soon
The **Copy Pattern** feature is a work in progress and is not yet available in a stable release.
:::

The planned **Copy Pattern** tool allows you to move individual sequencer patterns (1–16) between banks and projects. It is designed to offer granular control over track scope and part assignment.

![Tools - Copy Pattern](/img/screenshots/tools-copy-patterns.png)

## Current Workflow (Experimental)

1. **Source:** Select the bank (A–P) and pattern (1–16) in the current project.
2. **Destination:** Choose the target project, bank, and target patterns.
3. **Configure Options:** Refine what data is transferred.
4. **Execute:** Perform the pattern copy.

---

## Planned Copy Options

When stable, these features are intended to work as follows:

### Part Assignment
- **Keep Original:** Target patterns keep their current part assignment.
- **Copy Source Part:** The sound design from the source part is copied with the pattern, and assignments are updated.
- **User Selection:** Manually choose which target part to assign.

### Track Scope
- **All Tracks:** Copy triggers and p-locks for all 16 tracks.
- **Specific Tracks:** Move only selected tracks (e.g., only T1 and T2).

---

## Planned Data Coverage

When stable, the following data is expected to be transferred:
- **Triggers:** Standard, trigless, and one-shot triggers.
- **Parameter Locks:** Every parameter lock on every step.
- **Trig Conditions & Timing:** Probability, fill, and micro-timing.
- **Track Length & Scale:** Sequencer length and speed settings.

---

## Important Safety Notes

- **Destructive Operation:** Copying a pattern replaces existing sequences at the destination.
- **Backup Mandatory:** This is an experimental tool—**always back up your project** before using it. Changes are written directly to binary project files.
