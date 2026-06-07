export interface AudioFile {
  name: string;
  size: number;
  channels: number | null;
  bit_rate: number | null;
  sample_rate: number | null;
  is_directory: boolean;
  path: string;
}
