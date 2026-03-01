# Octatrack Manager

A desktop application for managing Elektron Octatrack projects, built with Tauri and React.

<p align="center">
  <img
    src="screenshots/Project discovery.png"
    alt="Octatrack Manager - Project discovery"
    style="width:80%; height:auto;"
  />
</p>
<p align="center" style="display: flex; justify-content: center; align-items: center; gap: 10px;">
  <a href="https://www.buymeacoffee.com/octatrackmanager" target="_blank">
    <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 47px; width: 150px;">
  </a>
  <a href="https://www.elektronauts.com/t/project-manager-for-octatrack/" target="_blank">
    <img src="public/contribute-on-elektraunauts-bg.png" alt="Contribute on Elektronauts" style="height: 50px;">
  </a>
</p>



## Features

- **Sets Discovery**: Automatically scan for Octatrack CF cards and local backups
- **Project Management**: Browse and edit Octatrack Sets with audio pool and project information
- **Audio Pool**: Browse, convert and mmanage the shared sample libraries
- **Cross-Platform**: Works on Linux, macOS, and Windows

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

- Feedbacks are welcome! Feel free to drop comments, ideas, feature requests to Elektronauts thread and shape the future of this project !
    - https://www.elektronauts.com/t/project-manager-for-octatrack/

## Credits

Built with:
- [Tauri](https://tauri.app/) - Desktop application framework
- [React](https://react.dev/) - UI framework
- [TypeScript](https://www.typescriptlang.org/) - Type-safe JavaScript
- [Vite](https://vitejs.dev/) - Frontend build tool
- [ot-tools-io](https://gitlab.com/ot-tools/ot-tools-io) - Octatrack file I/O library
- [sysinfo](https://github.com/GuillaumeGomez/sysinfo) - System information for device detection
- [walkdir](https://github.com/BurntSushi/walkdir) - Recursive directory traversal

