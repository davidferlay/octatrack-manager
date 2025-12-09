import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch, exit } from '@tauri-apps/plugin-process';
import './Version.css';

// Detect if we're running on Linux (used to handle AppImage restart limitations)
const isLinux = () => {
  const userAgent = navigator.userAgent.toLowerCase();
  return userAgent.includes('linux') && !userAgent.includes('android');
};

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

        // Try to relaunch (or exit on Linux where relaunch doesn't work reliably with AppImage)
        setDownloading(false);
        if (isLinux()) {
          // On Linux AppImage, relaunch() fails because the AppImage file has been replaced.
          // Show the restart link so user knows the update is ready.
          console.log('Linux detected - showing restart link');
          setReadyToRelaunch(true);
        } else {
          try {
            console.log('Attempting to relaunch app...');
            await relaunch();
          } catch (relaunchError) {
            console.error('Auto-relaunch failed:', relaunchError);
            setReadyToRelaunch(true);
          }
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
      if (isLinux()) {
        // On Linux AppImage, relaunch() fails after update because the AppImage file
        // has been replaced while the current process still holds references to the old one.
        // The safest approach is to exit and let the user manually restart.
        console.log('Linux detected - exiting for manual restart');
        await exit(0);
      } else {
        await relaunch();
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
          {isLinux() ? 'close to update' : 'restart for latest version'}
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
