---
sidebar_position: 1
---

# Introduction

**Octatrack Manager** is a free, open-source desktop application for browsing and managing [Elektron Octatrack](https://www.elektron.se/en/octatrack-explorer) projects. It runs on Linux, macOS, and Windows, and provides a rich graphical interface for tasks that are otherwise tedious or impossible to do on the device itself.

![Octatrack Manager - Project discovery](/img/project-discovery.png)

## What it does

Octatrack Manager lets you:

- **Discover projects** automatically by scanning CF cards, USB drives, and common local directories
- **Inspect projects** in detail — view metadata, mixer settings, MIDI configuration, memory settings, and all 16 banks with their patterns and sample slots
- **Manage audio pools** — browse, copy, move, and delete audio files with format information and transfer progress
- **Edit parts** — modify machine parameters, effects, LFOs, and MIDI settings for each track directly on your computer
- **Copy content** between projects using five powerful copy operations: banks, parts, patterns, tracks, and sample slots *(work in progress — coming soon)*

## Key concepts

Understanding Octatrack's terminology helps navigate the application:

| Concept | Description |
|---------|-------------|
| **Set** | A top-level directory containing an `AUDIO/` folder and one or more projects |
| **Audio Pool** | The `AUDIO/` folder within a Set — contains WAV/AIFF samples referenced by projects |
| **Project** | An Octatrack project (`.work` files) — contains 16 banks |
| **Bank** | One of 16 banks (A–P) — each bank holds 4 parts and 16 patterns per part |
| **Part** | A sound design snapshot for all 8 audio tracks and 8 MIDI tracks |
| **Pattern** | A sequence of 16 steps with triggers and parameter locks |
| **Static slot** | One of 128 sample slots loaded into RAM once, shared across patterns |
| **Flex slot** | One of 128 sample slots streamed from CF card in real time |

## Project structure

The app reads Octatrack's native binary file format:

```
MySet/
├── AUDIO/                    ← Audio pool (shared samples)
│   ├── kick.wav
│   └── snare.wav
├── MyProject/                ← Project directory
│   ├── project.work          ← Project metadata, settings
│   ├── bank01.work           ← Bank A data
│   ├── bank02.work           ← Bank B data
│   └── ...
└── AnotherProject/
    └── ...
```

Individual projects (without a parent Set) are also supported.

## Compatibility

:::warning Important
Octatrack Manager is **only compatible with projects saved on OS version 1.40 or later**. If you have projects from an older OS version, open and re-save them on the Octatrack with the latest firmware before using this application.
:::

## Getting started

Head to [Installation](./getting-started/installation.md) to download and install the app, then follow the [Quick Start](./getting-started/quick-start.md) guide to get up and running.
