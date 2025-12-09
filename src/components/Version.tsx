import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch, exit } from '@tauri-apps/plugin-process';
import './Version.css';

// Detect platform - relaunch() has known issues on Linux AppImage and macOS in Tauri v2
// See: https://github.com/tauri-apps/tauri/issues/13923 (macOS)
// See: https://github.com/electron-userland/electron-builder/issues/4650 (Linux AppImage)
const getPlatform = () => {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes('mac')) return 'macos';
  if (userAgent.includes('linux') && !userAgent.includes('android')) return 'linux';
  if (userAgent.includes('win')) return 'windows';
  return 'unknown';
};

// relaunch() fails on Linux (AppImage file replaced) and macOS (Tauri v2 bug)
const canRelaunch = () => getPlatform() === 'windows';

export function Version() {
  const [version, setVersion] = useState<string>('');
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [readyToRelaunch, setReadyToRelaunch] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  const checkAndDownloadUpdate = async () => {
    if (checking || downloading) return;

    setChecking(true);

    try {
      const update = await check();

      if (update?.available) {
        console.log(`Update available: ${update.version}`);
        // Auto-download
        setDownloading(true);
        setChecking(false);

        let downloadedBytes = 0;
        let totalBytes = 0;

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              setDownloadProgress(0);
              downloadedBytes = 0;
              totalBytes = event.data.contentLength || 0;
              console.log('Download started', totalBytes > 0 ? `(${(totalBytes / (1024 * 1024)).toFixed(2)} MB)` : '(size unknown)');
              break;
            case 'Progress':
              downloadedBytes += event.data.chunkLength;
              let progress: number;
              if (totalBytes > 0) {
                progress = (downloadedBytes / totalBytes) * 100;
              } else {
                progress = Math.min((downloadedBytes / (50 * 1024 * 1024)) * 100, 95);
              }
              setDownloadProgress(progress);
              console.log(`Download progress: ${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB${totalBytes > 0 ? ` / ${(totalBytes / (1024 * 1024)).toFixed(2)} MB (${progress.toFixed(1)}%)` : ` (${progress.toFixed(1)}%)`}`);
              break;
            case 'Finished':
              setDownloadProgress(100);
              console.log('Download finished');
              break;
          }
        });

        // Try to relaunch (only works reliably on Windows in Tauri v2)
        setDownloading(false);
        if (canRelaunch()) {
          try {
            console.log('Attempting to relaunch app...');
            await relaunch();
          } catch (relaunchError) {
            console.error('Auto-relaunch failed:', relaunchError);
            setReadyToRelaunch(true);
          }
        } else {
          // On Linux/macOS, relaunch() fails - show the close link instead
          console.log(`${getPlatform()} detected - showing close link`);
          setReadyToRelaunch(true);
        }
      } else {
        console.log('No updates available');
        setChecking(false);
      }
    } catch (err) {
      console.error('Error checking/downloading update:', err);
      setChecking(false);
      // Fail silently
    }
  };

  const handleRelaunch = async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      console.log('Attempting manual relaunch...');
      if (canRelaunch()) {
        await relaunch();
      } else {
        // On Linux/macOS, relaunch() fails - exit cleanly so user can manually restart
        console.log(`${getPlatform()} detected - exiting for manual restart`);
        await exit(0);
      }
    } catch (error) {
      console.error('Relaunch failed:', error);
      // If relaunch fails, exit the app so user can manually restart
      try {
        await exit(0);
      } catch {
        // Last resort: show alert
        alert('Unable to restart automatically. Please close and reopen the application manually.');
      }
    }
  };

  // Check for updates on mount (only in production, once per session)
  useEffect(() => {
    if (import.meta.env.PROD) {
      const hasChecked = sessionStorage.getItem('update-checked');
      if (!hasChecked) {
        checkAndDownloadUpdate();
        sessionStorage.setItem('update-checked', 'true');
      }
    }
  }, []);

  return (
    <div className="app-version-container">
      {downloading && (
        <div className="update-progress">
          <div className="update-progress-bar">
            <div
              className="update-progress-fill"
              style={{ width: `${downloadProgress}%` }}
            ></div>
          </div>
          <div className="update-progress-text">{downloadProgress.toFixed(1)}%</div>
        </div>
      )}
      {readyToRelaunch && (
        <a href="#" className="relaunch-link" onClick={handleRelaunch}>
          {canRelaunch() ? 'restart for latest version' : 'close to update'}
        </a>
      )}
      <div
        className={`app-version ${checking ? 'checking' : ''}`}
        onClick={checkAndDownloadUpdate}
        title="Click to check for updates"
      >
        v{version}
      </div>
    </div>
  );
}
