# Masta-Octa

**Masta-Octa** is an independent, unofficial GPL-3.0 desktop application based on the upstream Octatrack Manager project. It simplifies management of Elektron Octatrack projects with tools for browsing, inspecting, and editing projects away from the hardware.

<p align="center">
  <img
    src="user-guide/static/img/project-discovery.png"
    alt="Masta-Octa - Project discovery"
    style="width:80%; height:auto;"
  />
</p>

<p align="center" style="display: flex; justify-content: center; align-items: center; gap: 10px;">
  <a href="https://kaz4g.github.io/masterocta/" target="_blank">
    <strong>Read the User Guide</strong>
  </a>
  <span> | </span>
  <a href="https://www.elektronauts.com/t/project-manager-for-octatrack/233672" target="_blank">
    <strong>Upstream community discussion on Elektronauts</strong>
  </a>
</p>

## Key Features

- **Project Discovery:** Automatically scan CF cards, USB drives, and local backups to find your Sets and projects.
- **In-Depth Inspection:** View mixer settings, MIDI configuration, memory allocation, and metronome settings at a glance.
- **Pattern Visualization:** Explore every step of your sequences, including micro-timing, trig conditions, and chord information for MIDI tracks.
- **Audio Pool Management:** Browse your samples with detailed metadata and transfer files with **automatic WAV conversion** (44.1 kHz resampling).
- **Parts Editor:** Modify sound design snapshots for both audio and MIDI tracks, including machine parameters, effects, and a custom **LFO Designer**.
- **Bulk Operations:** Powerful tools for copying banks, parts, patterns, and sample slots between projects.


## Active Development

Masta-Octa is currently a **work in progress**. New functionalities are being added regularly to expand its capabilities.

We are constantly working to improve the application and add more power-user features. Your feedback and bug reports are essential to the project's growth.


## Documentation

For detailed instructions, troubleshooting, and feature explanations, please visit the official documentation:

- **[kaz4g.github.io/masterocta](https://kaz4g.github.io/masterocta/)**


## Installation

Masta-Octa does not publish signed binary releases yet. Build it from source by following the [Installation Guide](https://kaz4g.github.io/masterocta/docs/getting-started/installation). The upstream updater remains disabled.


## Compatibility

- This application is only compatible with projects saved on **Octatrack OS 1.40 or later**.
- Projects from older versions must be opened and re-saved on the hardware first.


## Contributing & Feedback

Feedback from the community is invaluable. Please share your experiences, bug reports, and ideas:

- **Upstream community discussion:** [Project Manager for Octatrack Thread](https://www.elektronauts.com/t/project-manager-for-octatrack/233672)
- **GitHub:** [Issues Page](https://github.com/kaz4g/masterocta/issues)


## Development

If you'd like to build the project locally:

```bash
git clone https://github.com/kaz4g/masterocta.git
cd masterocta
corepack enable
pnpm install --frozen-lockfile
pnpm run tauri:dev
```

## Credits & Tech Stack

Built with:
- [Upstream Octatrack Manager](https://github.com/davidferlay/octatrack-manager) - Original project and attribution
- [ot-tools-io](https://gitlab.com/ot-tools/ot-tools-io) - Octatrack file I/O library
- [Tauri](https://tauri.app/) - Desktop application framework
- [React](https://react.dev/) - UI framework
- [Vite](https://vitejs.dev/) - Frontend build tool
