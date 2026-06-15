import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { CopyProgressEvent, TransferItem } from "../types/transfer";
import type { AudioFile } from "../types/audioFile";

export interface OverwriteModalState {
  isOpen: boolean;
  fileName: string;
  sourcePath: string;
  transferId: string;
  pendingFiles: string[];
  currentIndex: number;
  fileSizes?: Map<string, number>;
  transferIds?: string[];
  destinationPath: string;
}

const INITIAL_OVERWRITE_MODAL: OverwriteModalState = {
  isOpen: false,
  fileName: '',
  sourcePath: '',
  transferId: '',
  pendingFiles: [],
  currentIndex: 0,
  destinationPath: '',
};

export function useAudioPoolTransfer(options?: { onComplete?: (destinationPath: string) => void }) {
  const onComplete = options?.onComplete;

  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [isTransferQueueOpen, setIsTransferQueueOpen] = useState(false);
  const [overwriteModal, setOverwriteModal] = useState<OverwriteModalState>(INITIAL_OVERWRITE_MODAL);
  const [overwriteAllMode, setOverwriteAllMode] = useState<'none' | 'overwrite' | 'skip'>('none');

  // Listen for copy progress events from Rust backend
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<CopyProgressEvent>("copy-progress", (event) => {
        const { file_path, transfer_id, stage, progress } = event.payload;

        setTransfers(prev => prev.map(t => {
          // Match by transfer_id if available, otherwise fall back to sourcePath
          // Only update if still in copying status (not cancelled)
          const matches = transfer_id ? t.id === transfer_id : t.sourcePath === file_path;
          if (matches && t.status === "copying") {
            return {
              ...t,
              stage,
              progress,
              bytesTransferred: progress * (t.fileSize || 1),
            };
          }
          return t;
        }));
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Auto-close transfers pane when all transfers complete successfully
  useEffect(() => {
    const activeCount = transfers.filter(t => t.status === "copying" || t.status === "pending").length;
    if (transfers.length > 0 && activeCount === 0) {
      const allSucceeded = transfers.every(t => t.status === "completed");
      if (allSucceeded) {
        const timer = setTimeout(() => {
          setIsTransferQueueOpen(false);
        }, 1500);
        return () => clearTimeout(timer);
      }
    }
  }, [transfers]);

  // Process files in parallel with a concurrency limit
  async function processFilesInParallel(
    sourcePaths: string[],
    transferIds: string[],
    destinationPath: string,
    fileSizes?: Map<string, number>,
    concurrency: number = 2,
    forceOverwrite: boolean = false
  ) {
    console.log(`[Parallel] Starting parallel processing of ${sourcePaths.length} files with concurrency ${concurrency}, forceOverwrite=${forceOverwrite}`);

    let conflictDetected = false;
    let conflictIndex = -1;
    const completedIndices = new Set<number>();
    const activePromises: Map<number, Promise<void>> = new Map();
    let queueIndex = 0;

    // Helper to process a single file - returns true if conflict detected
    const processFile = async (sourcePath: string, index: number): Promise<boolean> => {
      const transferId = transferIds[index];
      const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
      console.log(`[Parallel] Starting file ${index}: ${fileName}`);

      // Update status to "copying"
      setTransfers(prev => prev.map(t =>
        t.id === transferId ? { ...t, status: "copying" as const, startTime: Date.now() } : t
      ));

      try {
        await invoke("copy_audio_file_with_progress", {
          sourcePath: sourcePath,
          destinationDir: destinationPath,
          transferId: transferId,
          overwrite: forceOverwrite,
        });

        console.log(`[Parallel] Completed file ${index}: ${fileName}`);
        setTransfers(prev => prev.map(t => {
          if (t.id === transferId) {
            // Don't overwrite cancelled status - user already cancelled this transfer
            if (t.status === "cancelled") {
              return t;
            }
            return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
          }
          return t;
        }));
        completedIndices.add(index);
        return false; // No conflict
      } catch (error) {
        const errorStr = String(error);

        // Handle cancellation specifically
        if (errorStr.includes("cancelled")) {
          console.log(`[Parallel] Transfer cancelled: ${fileName}`);
          setTransfers(prev => prev.map(t =>
            t.id === transferId ? { ...t, status: "cancelled" as const } : t
          ));
          return false; // No conflict
        }

        if (errorStr.includes('already exists') && !forceOverwrite) {
          console.log(`[Parallel] Conflict detected for file ${index}: ${fileName}`);
          // Mark as pending conflict - will be handled by modal
          setTransfers(prev => prev.map(t => {
            if (t.id === transferId) {
              return { ...t, status: "pending" as const }; // Reset to pending for modal handling
            }
            return t;
          }));
          return true; // Conflict detected
        } else {
          console.error(`[Parallel] Error copying ${fileName}:`, error);
          setTransfers(prev => prev.map(t => {
            if (t.id === transferId) {
              return { ...t, status: "failed" as const, error: errorStr };
            }
            return t;
          }));
          completedIndices.add(index);
          return false; // Not a conflict, just an error
        }
      }
    };

    // Process files in parallel until a conflict is detected
    while (queueIndex < sourcePaths.length && !conflictDetected) {
      // Start new tasks to fill available slots
      const startedThisRound: number[] = [];
      while (queueIndex < sourcePaths.length && activePromises.size < concurrency && !conflictDetected) {
        const currentIndex = queueIndex++;
        const sourcePath = sourcePaths[currentIndex];
        startedThisRound.push(currentIndex);

        const promise = processFile(sourcePath, currentIndex).then((hasConflict) => {
          activePromises.delete(currentIndex);
          if (hasConflict && !conflictDetected) {
            conflictDetected = true;
            conflictIndex = currentIndex;
          }
        });
        activePromises.set(currentIndex, promise);
      }

      console.log(`[Parallel] Started ${startedThisRound.length} tasks this round (indices: ${startedThisRound.join(', ')}), active: ${activePromises.size}`);

      // Wait for at least one to complete
      if (activePromises.size > 0 && !conflictDetected) {
        console.log(`[Parallel] Waiting for one of ${activePromises.size} active tasks to complete...`);
        await Promise.race(Array.from(activePromises.values()));
        console.log(`[Parallel] A task completed, active now: ${activePromises.size}`);
      }
    }

    // Wait for all active promises to complete before handling conflict
    if (activePromises.size > 0) {
      console.log(`[Parallel] Waiting for ${activePromises.size} remaining tasks to complete...`);
      await Promise.all(Array.from(activePromises.values()));
    }

    console.log(`[Parallel] All tasks done. Conflict: ${conflictDetected}, conflictIndex: ${conflictIndex}`);

    // If a conflict was detected, switch to sequential processing with modal
    if (conflictDetected && conflictIndex >= 0) {
      // Find remaining files (not completed and not the conflict)
      const remainingPaths: string[] = [];
      const remainingIds: string[] = [];

      for (let i = conflictIndex; i < sourcePaths.length; i++) {
        if (!completedIndices.has(i)) {
          remainingPaths.push(sourcePaths[i]);
          remainingIds.push(transferIds[i]);
        }
      }

      if (remainingPaths.length > 0) {
        console.log(`[Parallel] Switching to sequential mode for ${remainingPaths.length} remaining files`);
        // Use processCopyQueue for sequential processing with modal support
        await processCopyQueue(remainingPaths, 0, destinationPath, false, fileSizes, false, remainingIds);
        return; // processCopyQueue will handle onComplete
      }
    }

    // Refresh destination files after all complete
    await onComplete?.(destinationPath);
  }

  // Process copy queue with overwrite handling
  async function processCopyQueue(
    sourcePaths: string[],
    startIndex: number,
    destinationPath: string,
    forceOverwrite: boolean = false,
    fileSizes?: Map<string, number>,
    forceSkip: boolean = false,
    transferIds?: string[]
  ) {
    for (let i = startIndex; i < sourcePaths.length; i++) {
      const sourcePath = sourcePaths[i];
      const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
      const fileSize = fileSizes?.get(sourcePath) || 0;

      // Use pre-generated transferId if available, otherwise generate new one
      const transferId = transferIds?.[i] || `${Date.now()}-${fileName}`;

      // If we have pre-generated IDs, update status to "copying"; otherwise add new transfer
      if (transferIds?.[i]) {
        setTransfers(prev => prev.map(t =>
          t.id === transferId ? { ...t, status: "copying" as const, startTime: Date.now() } : t
        ));
      } else {
        const newTransfer: TransferItem = {
          id: transferId,
          fileName: fileName,
          fileSize: fileSize,
          bytesTransferred: 0,
          status: "copying" as const,
          startTime: Date.now(),
          sourcePath: sourcePath,
        };
        setTransfers(prev => [...prev, newTransfer]);
      }

      // Use force flags directly (don't rely on state which may be stale due to async updates)
      const shouldOverwrite = forceOverwrite;
      const shouldSkip = forceSkip;

      try {
        // Use the progress-enabled command for single file copy with conversion
        await invoke("copy_audio_file_with_progress", {
          sourcePath: sourcePath,
          destinationDir: destinationPath,
          transferId: transferId,
          overwrite: shouldOverwrite,
        });

        setTransfers(prev => prev.map(t => {
          if (t.id === transferId) {
            // Don't overwrite cancelled status
            if (t.status === "cancelled") return t;
            return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
          }
          return t;
        }));
      } catch (error) {
        const errorStr = String(error);
        console.log('Copy error:', errorStr, 'overwriteAllMode:', overwriteAllMode);

        // Handle cancellation specifically
        if (errorStr.includes("cancelled")) {
          console.log(`Transfer cancelled: ${fileName}`);
          setTransfers(prev => prev.map(t =>
            t.id === transferId ? { ...t, status: "cancelled" as const } : t
          ));
          return; // Stop processing
        }

        // Check if it's a "file already exists" error
        if (errorStr.includes('already exists')) {
          // Check overwrite mode (use computed values that include force flags)
          if (shouldOverwrite) {
            // Retry with overwrite
            try {
              await invoke("copy_audio_file_with_progress", {
                sourcePath: sourcePath,
                destinationDir: destinationPath,
                transferId: transferId,
                overwrite: true,
              });
              setTransfers(prev => prev.map(t => {
                if (t.id === transferId) {
                  // Don't overwrite cancelled status
                  if (t.status === "cancelled") return t;
                  return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
                }
                return t;
              }));
            } catch (retryError) {
              const retryErrorStr = String(retryError);
              if (retryErrorStr.includes("cancelled")) {
                setTransfers(prev => prev.map(t =>
                  t.id === transferId ? { ...t, status: "cancelled" as const } : t
                ));
                return;
              }
              setTransfers(prev => prev.map(t => {
                if (t.id === transferId) {
                  // Don't overwrite cancelled status
                  if (t.status === "cancelled") return t;
                  return { ...t, status: "failed" as const, error: String(retryError) };
                }
                return t;
              }));
            }
          } else if (shouldSkip) {
            // Mark as skipped
            setTransfers(prev => prev.map(t => {
              if (t.id === transferId) {
                return { ...t, status: "cancelled" as const, error: 'Skipped (file exists)' };
              }
              return t;
            }));
          } else {
            // Show modal and pause processing
            setOverwriteModal({
              isOpen: true,
              fileName: fileName,
              sourcePath: sourcePath,
              transferId: transferId,
              pendingFiles: sourcePaths,
              currentIndex: i,
              fileSizes: fileSizes,
              transferIds: transferIds,
              destinationPath: destinationPath,
            });
            return; // Pause processing until user decides
          }
        } else {
          // Other error
          console.error(`Error copying ${fileName}:`, error);
          setTransfers(prev => prev.map(t => {
            if (t.id === transferId) {
              // Don't overwrite cancelled status
              if (t.status === "cancelled") return t;
              return { ...t, status: "failed" as const, error: errorStr };
            }
            return t;
          }));
        }
      }
    }

    await onComplete?.(destinationPath);
  }

  // Shared function to copy files to pool with parallel processing
  async function copyFilesToPool(sourcePaths: string[], destinationPath: string, fileSizes?: Map<string, number>) {
    setIsTransferQueueOpen(true);
    setOverwriteAllMode('none'); // Reset overwrite mode for new batch

    // First, add all files to the transfer queue with "pending" status
    const baseTimestamp = Date.now();
    const transferIds: string[] = [];
    const newTransfers: TransferItem[] = sourcePaths.map((sourcePath, index) => {
      const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
      const transferId = `${baseTimestamp}-${index}-${fileName}`;
      transferIds.push(transferId);
      return {
        id: transferId,
        fileName: fileName,
        fileSize: fileSizes?.get(sourcePath) || 0,
        bytesTransferred: 0,
        status: "pending" as const,
        startTime: baseTimestamp,
        sourcePath: sourcePath,
      };
    });

    setTransfers(prev => [...prev, ...newTransfers]);

    // Get system resources for dynamic concurrency
    let concurrency = 2; // Default fallback
    try {
      const resources = await invoke<{ cpu_cores: number; available_memory_mb: number; recommended_concurrency: number }>("get_system_resources");
      concurrency = resources.recommended_concurrency;
      console.log(`Parallel processing with concurrency: ${concurrency} (${resources.cpu_cores} cores, ${resources.available_memory_mb}MB available)`);
    } catch (e) {
      console.warn('Could not get system resources, using default concurrency:', e);
    }

    // Check for existing files BEFORE starting - this allows us to ask user once and then process all in parallel
    let existingFiles: string[] = [];
    try {
      const destFiles = await invoke<AudioFile[]>("list_audio_directory", { path: destinationPath });
      const destFileNames = new Set(destFiles.map(f => f.name.toLowerCase()));

      for (const sourcePath of sourcePaths) {
        const fileName = sourcePath.split('/').pop() || sourcePath.split('\\').pop() || sourcePath;
        // Get destination filename (will be .wav after conversion)
        const destFileName = fileName.replace(/\.(aif|aiff|mp3|flac|ogg|m4a)$/i, '.wav');
        if (destFileNames.has(destFileName.toLowerCase())) {
          existingFiles.push(sourcePath);
        }
      }
    } catch {
      // Ignore errors - continue without pre-check
    }

    if (existingFiles.length > 0) {
      console.log(`[Parallel] Found ${existingFiles.length} existing files, showing modal for batch decision`);
      // Show modal for batch overwrite decision
      setOverwriteModal({
        isOpen: true,
        fileName: existingFiles[0].split('/').pop() || existingFiles[0].split('\\').pop() || existingFiles[0],
        sourcePath: existingFiles[0],
        transferId: transferIds[sourcePaths.indexOf(existingFiles[0])],
        pendingFiles: sourcePaths,
        currentIndex: 0,
        fileSizes: fileSizes,
        transferIds: transferIds,
        destinationPath: destinationPath,
      });
      return; // Wait for user decision - modal handlers will call processFilesInParallel with the right flags
    }

    // No conflicts - process all files in parallel
    await processFilesInParallel(sourcePaths, transferIds, destinationPath, fileSizes, concurrency, false);
  }

  // Handle overwrite modal actions
  async function handleOverwrite() {
    const { sourcePath, transferId, pendingFiles, currentIndex, fileSizes, transferIds, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Ensure status is "copying" so progress events are applied
    setTransfers(prev => prev.map(t =>
      t.id === transferId ? { ...t, status: "copying" as const, startTime: Date.now() } : t
    ));

    // Start the overwrite copy in the background (don't await)
    // This allows the queue to continue processing while this file copies
    const copyPromise = invoke("copy_audio_file_with_progress", {
      sourcePath: sourcePath,
      destinationDir: destinationPath,
      transferId: transferId,
      overwrite: true,
    }).then(() => {
      setTransfers(prev => prev.map(t => {
        if (t.id === transferId) {
          // Don't overwrite cancelled status
          if (t.status === "cancelled") return t;
          return { ...t, status: "completed" as const, bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" };
        }
        return t;
      }));
    }).catch((error) => {
      const errorStr = String(error);
      if (errorStr.includes("cancelled")) {
        setTransfers(prev => prev.map(t =>
          t.id === transferId ? { ...t, status: "cancelled" as const } : t
        ));
        return;
      }
      setTransfers(prev => prev.map(t => {
        if (t.id === transferId) {
          // Don't overwrite cancelled status
          if (t.status === "cancelled") return t;
          return { ...t, status: "failed" as const, error: String(error) };
        }
        return t;
      }));
    });

    // Continue with remaining files immediately (don't wait for current file)
    await processCopyQueue(pendingFiles, currentIndex + 1, destinationPath, false, fileSizes, false, transferIds);

    // Wait for the overwrite copy to finish before refreshing
    await copyPromise;
  }

  async function handleOverwriteAll() {
    const { pendingFiles, fileSizes, transferIds, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));
    setOverwriteAllMode('overwrite');

    // Get concurrency for parallel processing
    let concurrency = 2;
    try {
      const resources = await invoke<{ cpu_cores: number; available_memory_mb: number; recommended_concurrency: number }>("get_system_resources");
      concurrency = resources.recommended_concurrency;
    } catch (e) {
      console.warn('Could not get system resources:', e);
    }

    // Process ALL files in parallel with forceOverwrite=true
    // Since user clicked "Overwrite All", process from the beginning
    console.log(`[Parallel] Overwrite All selected - processing ${pendingFiles.length} files in parallel with forceOverwrite=true`);
    await processFilesInParallel(pendingFiles, transferIds!, destinationPath, fileSizes, concurrency, true);
  }

  function handleSkip() {
    const { transferId, pendingFiles, currentIndex, fileSizes, transferIds, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Mark as skipped
    setTransfers(prev => prev.map(t => {
      if (t.id === transferId) {
        return { ...t, status: "cancelled" as const, error: 'Skipped (file exists)' };
      }
      return t;
    }));

    // Continue with remaining files
    processCopyQueue(pendingFiles, currentIndex + 1, destinationPath, false, fileSizes, false, transferIds);
  }

  async function handleSkipAll() {
    const { transferId, pendingFiles, currentIndex, fileSizes, transferIds, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));
    setOverwriteAllMode('skip');

    // Mark current as skipped
    setTransfers(prev => prev.map(t => {
      if (t.id === transferId) {
        return { ...t, status: "cancelled" as const, error: 'Skipped (file exists)' };
      }
      return t;
    }));

    // Continue with remaining files, passing forceSkip=true
    await processCopyQueue(pendingFiles, currentIndex + 1, destinationPath, false, fileSizes, true, transferIds);
  }

  function handleCancelImport() {
    const { transferId, transferIds, currentIndex, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Mark current and all remaining pending transfers as cancelled
    const remainingIds = transferIds ? new Set(transferIds.slice(currentIndex)) : new Set([transferId]);
    setTransfers(prev => prev.map(t => {
      if (remainingIds.has(t.id) && (t.status === "pending" || t.status === "copying")) {
        return { ...t, status: "cancelled" as const, error: 'Import cancelled' };
      }
      return t;
    }));

    // Notify caller that batch is done
    onComplete?.(destinationPath);
  }

  async function cancelTransfer(transferId: string) {
    // Call Rust backend to signal cancellation
    try {
      await invoke("cancel_audio_transfer", { transferId });
    } catch (e) {
      console.error("Failed to cancel transfer:", e);
    }
    // Update UI immediately
    setTransfers(prev => prev.map(t =>
      t.id === transferId && (t.status === "copying" || t.status === "pending")
        ? { ...t, status: "cancelled" as const }
        : t
    ));
  }

  function clearAllTransfers() {
    setTransfers([]);
  }

  function clearFinishedTransfers() {
    setTransfers(prev => prev.filter(t =>
      t.status !== "completed" && t.status !== "failed" && t.status !== "cancelled"
    ));
  }

  return {
    transfers,
    setTransfers,
    isTransferQueueOpen,
    setIsTransferQueueOpen,
    overwriteModal,
    copyFilesToPool,
    cancelTransfer,
    clearAllTransfers,
    clearFinishedTransfers,
    handleOverwrite,
    handleOverwriteAll,
    handleSkip,
    handleSkipAll,
    handleCancelImport,
  };
}
