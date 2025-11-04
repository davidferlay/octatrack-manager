# Octatrack Manager

A desktop application for managing Elektron Octatrack projects, built with Tauri and React.

<p align="center">
  <img
    src="public/octatrack-manager-osx.jpg"
    alt="Octatrack Manager screnshot on OSX.jpg"
    style="width:80%; height:auto;"
  />
</p>

## Features

- **Device Discovery**: Automatically scan for Octatrack CF cards mounted on your computer
- **Project Management**: View all projects on your Octatrack devices with their audio and preset information
- **Cross-Platform**: Works on Linux, macOS, and Windows
- **Modern UI**: Clean, responsive interface built with React and TypeScript

## Installation

### Download Pre-built Binaries

Download the latest release for your platform from the [Releases page](https://github.com/davidferlay/octatrack-manager/releases):

#### Linux
- **Debian/Ubuntu**: Download `.deb` and install with `sudo dpkg -i octatrack-manager_*.deb`
- **Fedora/RHEL**: Download `.rpm` and install with `sudo rpm -i octatrack-manager-*.rpm`
- **AppImage**: Download `.AppImage`, make it executable with `chmod +x`, then run it

#### Windows
- Download the `.msi` installer and run it
- Or download the `.exe` standalone installer

#### macOS

**Important**: The app is not code-signed, so macOS will block it by default.

1. Download the `.dmg` file for your architecture:
   - Intel Macs: `_x64_darwin.dmg`
   - Apple Silicon (M1/M2/M3/M4): `_aarch64_darwin.dmg`

2. Open the `.dmg` and drag the app to Applications

3. **Remove the quarantine flag** (required for unsigned apps):
   ```bash
   xattr -cr /Applications/octatrack-manager.app
   ```

4. Now you can open the app normally


## Usage

1. **Scan for Devices**: Click the "Scan for Devices" button to discover mounted Octatrack CF cards
2. **View Sets**: Browse all sets found on your devices, including their audio and preset information
3. **Device Information**: See mount points and device types for each discovered Octatrack


## How It Works

The application automatically scans for Octatrack Sets in these locations:

**Removable Drives:**
- CF cards and USB drives (when mounted)

**Home Directory:**
- `~/Documents`
- `~/Music`
- `~/Desktop`
- `~/Downloads`
- `~/octatrack`, `~/Octatrack`, or `~/OCTATRACK`

The scanner searches up to 3 levels deep looking for the characteristic Octatrack directory structure:
- **AUDIO/** folder (may contain WAV/AIFF samples)
- Project folders containing `.work` files

When a valid Octatrack Set is found, it displays:
- Set name and location
- Audio pool status
- Projects with bank information


## Architecture

- **Frontend**: React + TypeScript + Vite
- **Backend**: Rust + Tauri
- **Core Library**: [ot-tools-io](https://gitlab.com/ot-tools/ot-tools-io) for Octatrack file operations




## Available Commands

- `npm run tauri:dev` - Start development server
- `npm run tauri:build` - Build production bundles (.deb, .rpm, .AppImage)
- `npm run dev` - Start Vite dev server only (frontend)
- `npm run build` - Build frontend only


## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.


## Credits

Built with:
- [Tauri](https://tauri.app/) - Desktop application framework
- [React](https://react.dev/) - UI framework
- [ot-tools-io](https://gitlab.com/ot-tools/ot-tools-io) - Octatrack file I/O library
- [sysinfo](https://github.com/GuillaumeGomez/sysinfo) - System information library

