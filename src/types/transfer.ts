export interface CopyProgressEvent {
  file_path: string;
  transfer_id: string;
  stage: string;  // "converting", "resampling", "writing", "copying", "complete", "cancelled"
  progress: number;  // 0.0 to 1.0
}

export interface TransferItem {
  id: string;
  fileName: string;
  fileSize: number;
  bytesTransferred: number;
  status: "pending" | "copying" | "completed" | "failed" | "cancelled";
  error?: string;
  startTime: number;
  speed?: number;
  timeLeft?: number;
  sourcePath?: string;
  stage?: string;  // "converting", "resampling", "writing", "copying", "complete"
  progress?: number;  // 0.0 to 1.0
}
