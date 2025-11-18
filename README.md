# Octatrack Manager

A desktop application for managing Elektron Octatrack projects, built with Tauri and React.

<p align="center">
  <img
    src="public/octatrack-manager-osx.jpg"
    alt="Octatrack Manager screnshot on OSX.jpg"
    style="width:80%; height:auto;"
  />
</p>

<p align="center">
  <a href="https://www.buymeacoffee.com/octatrackmanager" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 40px !important;width: 145px !important;" >
  </a>
</p>

<p align="center">
  <a href="https://www.elektronauts.com/t/file-manager-for-octatrack" target="_blank">
    <img src="public/contribute-on-elektraunauts-bg.png" alt="Contribute on Elektronauts" style="height: 40px !important;width: 145px !important;" >
  </a>
</p>


## Features

- **Device Discovery**: Automatically scan for Octatrack CF cards and local backups
- **Set Management**: Browse Octatrack Sets with audio pool and project information
- **Individual Projects**: Discover standalone projects without audio pools
- **Project Details**: View comprehensive project information including:
  - Tempo, time signature, and OS version
  - Current state (bank, pattern, part, track)
  - Mixer settings (gain, direct, levels)
  - All banks with parts and patterns
  - Sample slots (static and flex) with paths and settings
- **Custom Directory Scanning**: Browse and add custom directories to scan
- **Cross-Platform**: Works on Linux, macOS, and Windows
- **Modern UI**: Clean, responsive interface built with React and TypeScript

## Compatibility

**Important**: This project is only compatible with projects that are created/saved on the latest OS (i.e. 1.40X).

For projects saved from another version, re-open and re-save that project with the OS on the latest version.

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

1. **Scan for Devices**: Click "Scan for Devices" to discover:
   - Mounted Octatrack CF cards
   - Local backups in common directories (Documents, Music, Downloads, etc.)
2. **Browse Custom Directories**: Use "Browse..." to add any directory to scan
3. **View Sets**: Explore Sets grouped by location with:
   - Audio pool status (✓/✗)
   - Number of projects in each Set
   - Device type (CF Card, USB, Local Copy)
4. **Individual Projects**: Projects without Sets appear in a dedicated "Individual Projects" section
5. **Project Details**: Click any project to view:
   - Complete metadata (tempo, time signature, current state)
   - Mixer settings
   - All 16 banks with their parts and patterns
   - Sample slots with assignment details


## How It Works

The application automatically scans for Octatrack content in these locations:

**Removable Drives:**
- CF cards and USB drives (when mounted)

**Home Directory:**
- `~/Documents`
- `~/Music`
- `~/Desktop`
- `~/Downloads`
- `~/octatrack`, `~/Octatrack`, or `~/OCTATRACK`


### Sets vs Individual Projects

The scanner distinguishes between two types of Octatrack content:

**Sets** (directories with an `AUDIO/` folder):
- Must contain an `AUDIO/` directory (even if empty)
- Must have at least one project subdirectory with `.work` files
- Audio pool status indicates if the `AUDIO/` folder contains valid WAV/AIFF samples
- Displayed grouped by location

**Individual Projects** (standalone):
- Directories containing `.work` files directly
- No parent `AUDIO/` directory
- All individual projects are collected in a single top-level "Individual Projects" section
- Useful for managing single projects or backups without full Set structure


### Project File Parsing

When you click on a project, the app parses the `project.work` and `bank*.work` files to display:
- Project metadata (tempo, time signature, OS version)
- Current state (active bank, pattern, part, track, muted/soloed tracks)
- Mixer settings (gains, direct outputs, levels)
- All 16 banks (A-P) with their 4 parts each
- Pattern names and lengths for each part
- Sample slot assignments (static and flex) with paths and settings



## Development


### Setup

```bash
# Clone the repository
git clone https://github.com/davidferlay/octatrack-manager.git
cd octatrack-manager
# Install dependencies
npm install
# Start development server
npm run tauri:dev
```

### Available Commands

- `npm run tauri:dev` - Start development server (hot-reload for both frontend and backend)
- `npm run tauri:build` - Build production bundles (.deb, .rpm, .AppImage, .dmg, .msi)
- `npm run dev` - Start Vite dev server only (frontend)
- `npm run build` - Build frontend only


## Contributing

Contributions and feedbacks are welcome! Please feel free to submit issues and pull requests.


## Credits

Built with:
- [Tauri](https://tauri.app/) - Desktop application framework
- [React](https://react.dev/) - UI framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Vite](https://vitejs.dev/) - Frontend build tool
- [ot-tools-io](https://gitlab.com/ot-tools/ot-tools-io) - Octatrack file I/O library
- [sysinfo](https://github.com/GuillaumeGomez/sysinfo) - System information for device detection
- [walkdir](https://github.com/BurntSushi/walkdir) - Recursive directory traversal

