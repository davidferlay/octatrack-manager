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
      console.error('Error details:', JSON.stringify(err, null, 2));
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

              // Calculate progress based on total size if available
              let progress: number;
              if (totalBytes > 0) {
                // Accurate progress based on actual file size
                progress = (downloadedBytes / totalBytes) * 100;
              } else {
                // Fallback: estimate based on typical installer size (~50MB)
                // Cap at 95% since we don't know the actual size
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

        // Relaunch the app to apply the update
        try {
          console.log('Attempting to relaunch app...');
          await relaunch();
        } catch (relaunchError) {
          console.error('Auto-relaunch failed:', relaunchError);
          // Update downloaded successfully, but auto-relaunch failed
          // User needs to manually restart to apply the update
          setError('Update downloaded! Please restart the app to complete installation.');
          setDownloading(false);
        }
      }
    } catch (err) {
      console.error('Error downloading update:', err);
      setError('Failed to download update');
      setDownloading(false);
    }
  };

  // Check for updates on mount (only in production, and only once per session)
  useEffect(() => {
    // Only check for updates in production builds
    if (import.meta.env.PROD) {
      // Check if we've already checked in this session
      const hasChecked = sessionStorage.getItem('update-checked');
      if (!hasChecked) {
        checkForUpdates();
        sessionStorage.setItem('update-checked', 'true');
      }
    }
  }, []);

  if (!updateAvailable && !checking && !error) {
    return null; // Don't show anything if no update is available
  }

  return (
    <div className="update-checker">
      {checking && (
        <div className="update-message">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className="update-spinner"></span>
            Checking for updates...
          </div>
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
