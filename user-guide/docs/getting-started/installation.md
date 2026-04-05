---
sidebar_position: 1
---

import DownloadLink from '@site/src/components/DownloadLink';

# Installation

Octatrack Manager is a cross-platform desktop application available for Windows, macOS, and Linux.

## Download

Always download the latest version from the official GitHub Releases page:

- [**Download Octatrack Manager**](https://github.com/davidferlay/octatrack-manager/releases/latest)

Choose the file that matches your operating system below.

---

## macOS

:::caution Important Note for Mac Users
Octatrack Manager is not yet "signed" with an Apple Developer certificate. This means macOS will block it by default unless you follow these specific steps.
:::

1. **Download:** Get the `.dmg` file for your Mac:
   - **Intel Macs:** <DownloadLink asset="mac-intel">Download for Intel Mac</DownloadLink>
   - **Apple Silicon (M1/M2/M3):** <DownloadLink asset="mac-arm">Download for Apple Silicon</DownloadLink>

2. **Install:** Open the `.dmg` file and drag **Octatrack Manager** into your **Applications** folder.

3. **Bypass Gatekeeper:**
   - Open your **Applications** folder in Finder.
   - **Right-click** (or Control-click) on Octatrack Manager.
   - Select **Open** from the menu.
   - A dialog will appear warning you about the unidentified developer. Click **Open** again.

   *If the app still refuses to open:*
   Open the **Terminal** app and paste this command, then press Enter:
   ```bash
   xattr -cr /Applications/octatrack-manager.app
   ```
   This command removes the "quarantine" attribute that prevents the app from launching.

---

## Windows

1. **Download:** Get the installer for Windows: <DownloadLink asset="windows-msi">Download .msi</DownloadLink> (recommended) or <DownloadLink asset="windows-exe">Download .exe</DownloadLink>.
2. **Install:** Double-click the file and follow the setup wizard instructions.
3. **Launch:** Open Octatrack Manager from your Start menu or Desktop shortcut.

---

## Linux

We provide three package formats for Linux users:

- **Debian / Ubuntu:** <DownloadLink asset="linux-deb">Download .deb</DownloadLink> and install it:
  ```bash
  sudo dpkg -i octatrack-manager_*.deb
  ```

- **Fedora / RHEL:** <DownloadLink asset="linux-rpm">Download .rpm</DownloadLink> and install it:
  ```bash
  sudo rpm -i octatrack-manager-*.rpm
  ```

- **AppImage (Universal):** <DownloadLink asset="linux-appimage">Download .AppImage</DownloadLink>, make it executable, and run it:
  ```bash
  chmod +x octatrack-manager_*.AppImage
  ./octatrack-manager_*.AppImage
  ```

---

## Verifying Installation

Launch the application. You should see the **Home** screen with a **Scan for Projects** button. If the application starts successfully, you are ready to proceed to the [Quick Start](./quick-start.md) guide.

## Updating

The app includes an automatic update checker. When a new version is available, you will see a notification in the app header. Click the version number <img src={require('@site/static/img/screenshots/project-details-menu-update.png').default} alt="Version badge" style={{height: '34px', verticalAlign: 'middle'}} /> to manually check and download the latest version.

To update manually, simply download the latest installer for your platform and run it. It will automatically replace the old version while keeping your settings intact.
