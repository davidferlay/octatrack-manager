# Octatrack Manager

A desktop application for managing Elektron Octatrack projects, built with Tauri and React.

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

The application scans all mounted drives on your system looking for the characteristic Octatrack directory structure:
- **Audio/** folder containing samples and `.ot` files
- **Presets/** folder containing `.work` project files

When a valid Octatrack set is found, it's displayed with:
- Set name
- Mount location
- Audio folder status
- Presets folder status (with `.work` files)


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

