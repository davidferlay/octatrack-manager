import { useState, useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import './UpdateChecker.css';

export function UpdateChecker() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string>('');
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkForUpdates = async () => {
    setChecking(true);
    setError(null);

    try {
      const update = await check();

      if (update?.available) {
        setUpdateAvailable(true);
        setUpdateVersion(update.version);
        console.log(`Update available: ${update.version}`);
      } else {
        setUpdateAvailable(false);
        console.log('No updates available');
      }
    } catch (err) {
      console.error('Error checking for updates:', err);
      // Don't show error to users - fail silently
      // This is expected if no releases are published yet
    } finally {
      setChecking(false);
    }
  };

  const downloadAndInstall = async () => {
    setDownloading(true);
    setError(null);

    try {
      const update = await check();

      if (update?.available) {
        let downloadedBytes = 0;

        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              setDownloadProgress(0);
              downloadedBytes = 0;
              console.log('Download started');
              break;
            case 'Progress':
              downloadedBytes += event.data.chunkLength;
              // Since we don't have total size, show indeterminate progress
              // Use a percentage based on chunks received (approximate)
              const progress = Math.min((downloadedBytes / (1024 * 1024)) * 10, 99);
              setDownloadProgress(progress);
              console.log(`Download progress: ${downloadedBytes} bytes`);
              break;
            case 'Finished':
              setDownloadProgress(100);
              console.log('Download finished');
              break;
          }
        });

        // Relaunch the app to apply the update
        await relaunch();
      }
    } catch (err) {
      console.error('Error downloading update:', err);
      setError('Failed to download update');
      setDownloading(false);
    }
  };

  // Check for updates on mount (only in production)
  useEffect(() => {
    // Only check for updates in production builds
    if (import.meta.env.PROD) {
      checkForUpdates();
    }
  }, []);

  if (!updateAvailable && !checking && !error) {
    return null; // Don't show anything if no update is available
  }

  return (
    <div className="update-checker">
      {checking && (
        <div className="update-message">
          <span className="update-spinner"></span>
          Checking for updates...
        </div>
      )}

      {error && (
        <div className="update-message update-error">
          {error}
          <button onClick={checkForUpdates} className="update-retry-button">
            Retry
          </button>
        </div>
      )}

      {updateAvailable && !downloading && (
        <div className="update-message update-available">
          <div className="update-info">
            <strong>Update available:</strong> v{updateVersion}
          </div>
          <button onClick={downloadAndInstall} className="update-install-button">
            Download and Install
          </button>
          <button onClick={() => setUpdateAvailable(false)} className="update-dismiss-button">
            Later
          </button>
        </div>
      )}

      {downloading && (
        <div className="update-message update-downloading">
          <div className="update-info">
            Downloading update... {downloadProgress.toFixed(1)}%
          </div>
          <div className="update-progress-bar">
            <div
              className="update-progress-fill"
              style={{ width: `${downloadProgress}%` }}
            ></div>
          </div>
        </div>
      )}
    </div>
  );
}
