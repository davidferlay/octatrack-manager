export interface AudioFile {
  name: string;
  size: number;
  channels: number | null;
  bit_rate: number | null;
  sample_rate: number | null;
  is_directory: boolean;
  path: string;
}

/** One place an Audio Pool file is referenced from (see PoolUsageEntry in Rust). */
export interface PoolUsageEntry {
  project: string;
  /** Absolute path of the project directory `project` names (used to link to it). */
  project_path: string;
  bank: number;
  kind: string; // "machine" | "lock" | "assigned"
  track: number;
  part: number | null;
  pattern: number | null;
  step: number | null;
  audible: boolean;
  /** Slot label (e.g. "F46", "S16"), set only when kind === "assigned". */
  slot: string | null;
}

/** Result of the rename_file command (see RenameResult in Rust). */
export interface RenameResult {
  new_path: string;
  /** Project directories whose sample slots were repointed onto the new name. */
  projects_updated: string[];
  slots_updated: number;
}
