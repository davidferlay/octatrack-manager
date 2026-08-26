import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import './Version.css';

export function Version() {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <div className="app-version-container">
      <div className="app-version">v{version}</div>
    </div>
  );
}
