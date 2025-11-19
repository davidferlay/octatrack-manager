import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import './Version.css';

interface VersionProps {
  fixed?: boolean;
}

export function Version({ fixed = false }: VersionProps) {
  const [version, setVersion] = useState<string>('');
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  const handleClick = async () => {
    if (checking) return;

    setChecking(true);
    setMessage('Checking...');

    try {
      const update = await check();

      if (update?.available) {
        setMessage(`Update available: v${update.version}`);
        console.log(`Update available: ${update.version}`);
      } else {
        setMessage('You are up to date!');
      }
    } catch (err) {
      console.error('Error checking for updates:', err);
      console.error('Error details:', JSON.stringify(err, null, 2));
      setMessage('Check failed');
    } finally {
      setChecking(false);
      // Clear message after 3 seconds
      setTimeout(() => setMessage(''), 3000);
    }
  };

  return (
    <div className="app-version-container">
      <div
        className={`app-version ${fixed ? 'fixed' : ''} ${checking ? 'checking' : ''}`}
        onClick={handleClick}
        title="Click to check for updates"
      >
        v{version}
      </div>
      {message && <div className="version-message">{message}</div>}
    </div>
  );
}
