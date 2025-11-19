import { useState, useEffect } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import './Version.css';

interface VersionProps {
  fixed?: boolean;
}

export function Version({ fixed = false }: VersionProps) {
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    getVersion().then(setVersion).catch(console.error);
  }, []);

  return (
    <div className={`app-version ${fixed ? 'fixed' : ''}`}>
      v{version}
    </div>
  );
}
