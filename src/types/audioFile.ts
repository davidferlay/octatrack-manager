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
  bank: number;
  kind: string;
  track: number;
  part: number | null;
  pattern: number | null;
  step: number | null;
  audible: boolean;
}
