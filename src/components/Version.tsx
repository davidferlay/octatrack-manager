import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { PRODUCT_NAME } from '../branding';
import './Version.css';

export function Version() {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <div
      className="app-version-container"
      aria-label={version ? `${PRODUCT_NAME} version ${version}` : `${PRODUCT_NAME} version`}
    >
      <div className="app-version">v{version}</div>
    </div>
  );
}
