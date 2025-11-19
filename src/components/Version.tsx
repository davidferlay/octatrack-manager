import packageJson from '../../package.json';
import './Version.css';

interface VersionProps {
  fixed?: boolean;
}

export function Version({ fixed = false }: VersionProps) {
  return (
    <div className={`app-version ${fixed ? 'fixed' : ''}`}>
      v{packageJson.version}
    </div>
  );
}
