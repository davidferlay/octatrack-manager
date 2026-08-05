function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

// exclude_backups only ever changes whether a project's own backups/ subtree
// is included in the scan (see purge.rs's compute_project_unused_files) - it
// never affects any other directory's collapse computation, so toggling it
// can be emulated client-side by filtering an already-fetched "maximal" scan
// instead of re-hitting the backend.
export function isUnderBackupsDir(path: string, projectRoots: string[]): boolean {
  const normalized = normalizeSlashes(path)
  return projectRoots.some((root) => {
    const backupsRoot = `${normalizeSlashes(root)}/backups`
    return normalized === backupsRoot || normalized.startsWith(`${backupsRoot}/`)
  })
}
