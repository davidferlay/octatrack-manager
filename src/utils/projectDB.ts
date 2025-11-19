import Dexie, { Table } from 'dexie';
import type { ProjectMetadata, Bank } from '../context/ProjectsContext';

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
}

export interface CachedBank {
  id: string; // Composite key: path + bankId (e.g., "/path/to/project:A")
  path: string; // Project path
  bankId: string; // Bank ID (A-P)
  bank: Bank;
  timestamp: number;
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
  metadata: ProjectMetadata
): Promise<void> {
  try {
    await db.projectMetadata.put({
      path,
      metadata,
      timestamp: Date.now()
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
  bank: Bank
): Promise<void> {
  try {
    const id = `${path}:${bankId}`;
    await db.projectBanks.put({
      id,
      path,
      bankId,
      bank,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error saving bank to IndexedDB:', error);
    throw error;
  }
}

/**
 * Save a project to cache (metadata + all banks)
 */
export async function setCachedProject(
  path: string,
  metadata: ProjectMetadata,
  banks: Bank[]
): Promise<void> {
  try {
    // Save metadata
    await setCachedMetadata(path, metadata);

    // Save each bank separately
    const bankPromises = banks.map(bank =>
      setCachedBank(path, bank.id, bank)
    );
    await Promise.all(bankPromises);
  } catch (error) {
    console.error('Error saving project to IndexedDB:', error);
    throw error;
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
