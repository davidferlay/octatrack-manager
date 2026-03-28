import React from 'react';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

const ASSETS = {
  'mac-intel': 'octatrack-manager_{version}_x64.dmg',
  'mac-arm': 'octatrack-manager_{version}_aarch64.dmg',
  'windows-msi': 'octatrack-manager_{version}_x64_en-US.msi',
  'windows-exe': 'octatrack-manager_{version}_x64-setup.exe',
  'linux-deb': 'octatrack-manager_{version}_amd64.deb',
  'linux-rpm': 'octatrack-manager-{version}-1.x86_64.rpm',
  'linux-appimage': 'octatrack-manager_{version}_amd64.AppImage',
};

export default function DownloadLink({ asset, children }) {
  const { siteConfig } = useDocusaurusContext();
  const version = siteConfig.customFields?.releaseVersion;
  const template = ASSETS[asset];

  if (!version || !template) {
    const fallback = `https://github.com/davidferlay/octatrack-manager/releases/latest`;
    return <a href={fallback}>{children}</a>;
  }

  const filename = template.replace('{version}', version);
  const url = `https://github.com/davidferlay/octatrack-manager/releases/download/v${version}/${filename}`;
  return <a href={url}>{children}</a>;
}
