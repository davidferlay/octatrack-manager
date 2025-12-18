import Dexie, { Table } from 'dexie';
import type { ProjectMetadata, Bank } from '../context/ProjectsContext';

// File timestamps from the backend for cache validation
export interface ProjectFileTimestamps {
  project_file: number | null;  // Modification time of project.work or project.strd
  bank_files: number[];         // Modification times of bank01.work through bank16.work
}

export interface CachedProjectData {
  path: string; // Primary key
  metadata: ProjectMetadata;
  banks: Bank[];
  timestamp: number;
}

export interface CachedMetadata {
  path: string; // Primary key
  metadata: ProjectMetadata;
  timestamp: number;
  fileTimestamps?: ProjectFileTimestamps; // File modification times for cache validation
}

export interface CachedBank {
  id: string; // Composite key: path + bankId (e.g., "/path/to/project:A")
  path: string; // Project path
  bankId: string; // Bank ID (A-P)
  bank: Bank;
  timestamp: number;
  fileTimestamp?: number; // File modification time for this bank file
}

export class ProjectDatabase extends Dexie {
  // Keep old table for migration compatibility
  projects!: Table<CachedProjectData, string>;
  // New optimized tables
  projectMetadata!: Table<CachedMetadata, string>;
  projectBanks!: Table<CachedBank, string>;

  constructor() {
    super('OctatrackProjectCache');

    // Version 1: Original schema (deprecated)
    this.version(1).stores({
      projects: 'path, timestamp'
    });

    // Version 2: Optimized schema with split storage
    this.version(2).stores({
      projects: null, // Delete old table
      projectMetadata: 'path, timestamp',
      projectBanks: 'id, path, bankId, timestamp'
    });
  }
}

// Create and export a singleton instance
export const db = new ProjectDatabase();

/**
 * Check if an error is a QuotaExceededError
 */
function isQuotaError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'QuotaExceededError' ||
           error.message.includes('QuotaExceeded') ||
           error.message.includes('not enough space');
  }
  return false;
}

/**
 * Clear old entries to free up space (keeps most recent 5 projects)
 */
async function clearOldEntries(): Promise<void> {
  try {
    const metadata = await db.projectMetadata.orderBy('timestamp').toArray();

    // Keep only the 5 most recent projects
    if (metadata.length > 5) {
      const toDelete = metadata.slice(0, metadata.length - 5);
      for (const entry of toDelete) {
        await db.projectMetadata.delete(entry.path);
        await db.projectBanks.where('path').equals(entry.path).delete();
      }
      console.log(`Cleared ${toDelete.length} old project(s) from cache to free space`);
    }
  } catch (error) {
    console.error('Error clearing old entries:', error);
  }
}

/**
 * Get cached project metadata only (fast!)
 */
export async function getCachedMetadata(path: string): Promise<ProjectMetadata | null> {
  try {
    const cached = await db.projectMetadata.get(path);
    return cached ? cached.metadata : null;
  } catch (error) {
    console.error('Error getting cached metadata from IndexedDB:', error);
    return null;
  }
}

/**
 * Get cached metadata with file timestamps for validation
 */
export async function getCachedMetadataWithTimestamps(path: string): Promise<CachedMetadata | null> {
  try {
    return await db.projectMetadata.get(path) ?? null;
  } catch (error) {
    console.error('Error getting cached metadata from IndexedDB:', error);
    return null;
  }
}

/**
 * Get cached bank with file timestamp for validation
 */
export async function getCachedBankWithTimestamp(path: string, bankId: string): Promise<CachedBank | null> {
  try {
    const id = `${path}:${bankId}`;
    return await db.projectBanks.get(id) ?? null;
  } catch (error) {
    console.error('Error getting cached bank from IndexedDB:', error);
    return null;
  }
}

/**
 * Get a specific cached bank by path and bank ID
 */
export async function getCachedBank(path: string, bankId: string): Promise<Bank | null> {
  try {
    const id = `${path}:${bankId}`;
    const cached = await db.projectBanks.get(id);
    return cached ? cached.bank : null;
  } catch (error) {
    console.error('Error getting cached bank from IndexedDB:', error);
    return null;
  }
}

/**
 * Get all cached banks for a project
 */
export async function getCachedBanks(path: string): Promise<Bank[]> {
  try {
    const cachedBanks = await db.projectBanks
      .where('path')
      .equals(path)
      .toArray();

    // Sort banks by ID (A-P)
    return cachedBanks
      .sort((a, b) => a.bankId.localeCompare(b.bankId))
      .map(cb => cb.bank);
  } catch (error) {
    console.error('Error getting cached banks from IndexedDB:', error);
    return [];
  }
}

/**
 * Get a cached project (metadata + all banks) - for backwards compatibility
 */
export async function getCachedProject(path: string): Promise<CachedProjectData | null> {
  try {
    const metadata = await getCachedMetadata(path);
    if (!metadata) return null;

    const banks = await getCachedBanks(path);
    if (banks.length === 0) return null;

    return {
      path,
      metadata,
      banks,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error getting cached project from IndexedDB:', error);
    return null;
  }
}

/**
 * Save project metadata (fast!)
 */
export async function setCachedMetadata(
  path: string,
  metadata: ProjectMetadata,
  fileTimestamps?: ProjectFileTimestamps
): Promise<void> {
  try {
    await db.projectMetadata.put({
      path,
      metadata,
      timestamp: Date.now(),
      fileTimestamps
    });
  } catch (error) {
    console.error('Error saving metadata to IndexedDB:', error);
    throw error;
  }
}

/**
 * Save a single bank
 */
export async function setCachedBank(
  path: string,
  bankId: string,
  bank: Bank,
  fileTimestamp?: number
): Promise<void> {
  try {
    const id = `${path}:${bankId}`;
    await db.projectBanks.put({
      id,
      path,
      bankId,
      bank,
      timestamp: Date.now(),
      fileTimestamp
    });
  } catch (error) {
    console.error('Error saving bank to IndexedDB:', error);
    throw error;
  }
}

/**
 * Save a project to cache (metadata + all banks)
 * Handles QuotaExceededError by clearing old entries and retrying
 */
export async function setCachedProject(
  path: string,
  metadata: ProjectMetadata,
  banks: Bank[],
  fileTimestamps?: ProjectFileTimestamps
): Promise<void> {
  const saveProject = async () => {
    // Save metadata with file timestamps
    await setCachedMetadata(path, metadata, fileTimestamps);

    // Save each bank separately with its file timestamp
    const bankIds = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
    const bankPromises = banks.map(bank => {
      const bankIndex = bankIds.indexOf(bank.id);
      const bankFileTimestamp = fileTimestamps?.bank_files[bankIndex];
      return setCachedBank(path, bank.id, bank, bankFileTimestamp);
    });
    await Promise.all(bankPromises);
  };

  try {
    await saveProject();
  } catch (error) {
    if (isQuotaError(error)) {
      console.warn('Storage quota exceeded, clearing old cache entries...');
      await clearOldEntries();

      // Retry once after clearing
      try {
        await saveProject();
        console.log('Successfully saved project after clearing old cache');
      } catch (retryError) {
        // If it still fails, log but don't throw - caching is optional
        console.warn('Could not cache project after clearing old entries. Project will still load but without caching.');
      }
    } else {
      console.error('Error saving project to IndexedDB:', error);
      // Don't throw - caching failure shouldn't break the app
    }
  }
}

/**
 * Clear a specific project from cache or all projects
 */
export async function clearProjectCache(path?: string): Promise<void> {
  try {
    if (path) {
      // Clear metadata
      await db.projectMetadata.delete(path);
      // Clear all banks for this project
      await db.projectBanks.where('path').equals(path).delete();
    } else {
      // Clear everything
      await db.projectMetadata.clear();
      await db.projectBanks.clear();
    }
  } catch (error) {
    console.error('Error clearing project cache from IndexedDB:', error);
    throw error;
  }
}

/**
 * Get all cached project paths (useful for debugging)
 */
export async function getAllCachedProjectPaths(): Promise<string[]> {
  try {
    const metadata = await db.projectMetadata.toArray();
    return metadata.map(m => m.path);
  } catch (error) {
    console.error('Error getting cached project paths from IndexedDB:', error);
    return [];
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  projectCount: number;
  bankCount: number;
  oldestTimestamp: number;
  newestTimestamp: number;
}> {
  try {
    const [metadata, banks] = await Promise.all([
      db.projectMetadata.toArray(),
      db.projectBanks.toArray()
    ]);

    if (metadata.length === 0) {
      return { projectCount: 0, bankCount: 0, oldestTimestamp: 0, newestTimestamp: 0 };
    }

    const allTimestamps = [
      ...metadata.map(m => m.timestamp),
      ...banks.map(b => b.timestamp)
    ];

    return {
      projectCount: metadata.length,
      bankCount: banks.length,
      oldestTimestamp: Math.min(...allTimestamps),
      newestTimestamp: Math.max(...allTimestamps)
    };
  } catch (error) {
    console.error('Error getting cache stats from IndexedDB:', error);
    return { projectCount: 0, bankCount: 0, oldestTimestamp: 0, newestTimestamp: 0 };
  }
}

/**
 * Validate cache against current file timestamps
 * Returns true if cache is valid (files haven't changed), false if stale
 */
export async function isCacheValid(
  path: string,
  currentTimestamps: ProjectFileTimestamps
): Promise<boolean> {
  try {
    const cachedMeta = await getCachedMetadataWithTimestamps(path);

    if (!cachedMeta?.fileTimestamps) {
      // No cached timestamps - cache is from before timestamp tracking
      console.log('[Cache Validation] No cached timestamps found - cache is stale');
      return false;
    }

    const cached = cachedMeta.fileTimestamps;

    // Check project file timestamp
    if (cached.project_file !== currentTimestamps.project_file) {
      console.log('[Cache Validation] Project file changed:', {
        cached: cached.project_file,
        current: currentTimestamps.project_file
      });
      return false;
    }

    // Check bank file timestamps
    for (let i = 0; i < 16; i++) {
      const cachedBank = cached.bank_files[i] || 0;
      const currentBank = currentTimestamps.bank_files[i] || 0;

      if (cachedBank !== currentBank) {
        const bankId = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'][i];
        console.log(`[Cache Validation] Bank ${bankId} file changed:`, {
          cached: cachedBank,
          current: currentBank
        });
        return false;
      }
    }

    console.log('[Cache Validation] Cache is valid - no file changes detected');
    return true;
  } catch (error) {
    console.error('Error validating cache:', error);
    return false; // Assume stale on error
  }
}
