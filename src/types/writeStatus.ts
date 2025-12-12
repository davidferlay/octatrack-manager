// Types for tracking file write operations across the app

export type WriteStatusState = 'idle' | 'writing' | 'success' | 'error';

export interface WriteStatus {
  state: WriteStatusState;
  message?: string;  // Optional message to display (e.g., "Saving Part 1...", "Reloading...")
}

// Default idle status
export const IDLE_STATUS: WriteStatus = { state: 'idle' };

// Helper to create status updates
export const writeStatus = {
  idle: (): WriteStatus => ({ state: 'idle' }),
  writing: (message?: string): WriteStatus => ({ state: 'writing', message }),
  success: (message?: string): WriteStatus => ({ state: 'success', message }),
  error: (message?: string): WriteStatus => ({ state: 'error', message }),
};
