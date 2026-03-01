---
sidebar_position: 1
---

# Installation

Download the latest release for your platform from the [GitHub Releases page](https://github.com/davidferlay/octatrack-manager/releases).

## Linux

Three package formats are available:

### Debian / Ubuntu

Download the `.deb` package and install it:

```bash
sudo dpkg -i octatrack-manager_*.deb
```

### Fedora / RHEL

Download the `.rpm` package and install it:

```bash
sudo rpm -i octatrack-manager-*.rpm
```

### AppImage (universal)

Download the `.AppImage` file, make it executable, and run it:

```bash
chmod +x octatrack-manager_*.AppImage
./octatrack-manager_*.AppImage
```

## Windows

Two installers are available:

- **MSI installer** — recommended for most users; run the `.msi` file and follow the setup wizard
- **EXE installer** — standalone executable; run the `.exe` file directly

## macOS

:::caution Code signing
The app is not code-signed, so macOS will block it by default. Follow the steps below carefully.
:::

1. Download the `.dmg` file for your architecture:
   - **Intel Macs**: `_x64_darwin.dmg`
   - **Apple Silicon (M1/M2/M3/M4)**: `_aarch64_darwin.dmg`

2. Open the `.dmg` and drag **Octatrack Manager** to your Applications folder.

3. Open a Terminal and run the following command to remove the macOS quarantine attribute:

   ```bash
   xattr -cr /Applications/octatrack-manager.app
   ```

4. You can now open the app normally from your Applications folder or Launchpad.

## Verifying the installation

Launch the application. You should see the **Home** screen with a "Scan for Devices" button. If the application starts successfully, installation is complete.

## Updating

To update, download the latest release package for your platform and install it over the existing installation. No manual uninstallation is required.
