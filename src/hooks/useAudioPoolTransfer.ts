import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { CopyProgressEvent, TransferItem } from "../types/transfer";

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

function baseName(p: string): string {
  return p.split('/').pop() || p.split('\\').pop() || p;
}

async function getConcurrency(): Promise<number> {
  try {
    const resources = await invoke<{ recommended_concurrency: number }>("get_system_resources");
    return resources.recommended_concurrency;
  } catch {
    return 2; // default fallback
  }
}

type CopyOutcome = "ok" | "cancelled" | "conflict" | "failed";

export function useAudioPoolTransfer(options?: { onComplete?: (destinationPath: string) => void }) {
  const onComplete = options?.onComplete;

  const [transfers, setTransfers] = useState<TransferItem[]>([]);
  const [isTransferQueueOpen, setIsTransferQueueOpen] = useState(false);
  const [overwriteModal, setOverwriteModal] = useState<OverwriteModalState>(INITIAL_OVERWRITE_MODAL);

  // Per-batch collection of successfully-copied destination paths, plus an optional
  // callback fired when the batch settles (used by slot imports to assign afterwards).
  const copiedDestPathsRef = useRef<string[]>([]);
  const onCopiedRef = useRef<((destPaths: string[]) => void) | undefined>(undefined);

  // Fire the hook-level refresh + the per-batch onCopied callback once a batch finishes.
  async function finishBatch(destinationPath: string) {
    await onComplete?.(destinationPath);
    const cb = onCopiedRef.current;
    if (cb) cb([...copiedDestPathsRef.current]);
  }

  // Patch a transfer, but never resurrect one the user already cancelled.
  const updateTransfer = (id: string, patch: Partial<TransferItem>) =>
    setTransfers(prev => prev.map(t =>
      t.id === id && t.status !== "cancelled" ? { ...t, ...patch } : t));

  const markCompleted = (id: string) =>
    setTransfers(prev => prev.map(t =>
      t.id === id && t.status !== "cancelled"
        ? { ...t, status: "completed", bytesTransferred: t.fileSize || 1, progress: 1.0, stage: "complete" }
        : t));

  const markCancelled = (id: string, error?: string) =>
    setTransfers(prev => prev.map(t => (t.id === id ? { ...t, status: "cancelled", error } : t)));

  const markFailed = (id: string, error: string) =>
    setTransfers(prev => prev.map(t =>
      t.id === id && t.status !== "cancelled" ? { ...t, status: "failed", error } : t));

  // Single copy invoke + result handling. Returns the outcome so callers can sequence/queue.
  async function runCopy(
    sourcePath: string,
    transferId: string,
    destinationPath: string,
    overwrite: boolean
  ): Promise<CopyOutcome> {
    try {
      const destPath = await invoke<string>("copy_audio_file_with_progress", {
        sourcePath,
        destinationDir: destinationPath,
        transferId,
        overwrite,
      });
      markCompleted(transferId);
      if (destPath) copiedDestPathsRef.current.push(destPath);
      return "ok";
    } catch (error) {
      const errorStr = String(error);
      if (errorStr.includes("cancelled")) {
        markCancelled(transferId);
        return "cancelled";
      }
      if (errorStr.includes("already exists") && !overwrite) {
        return "conflict";
      }
      console.error(`Error copying ${baseName(sourcePath)}:`, error);
      markFailed(transferId, errorStr);
      return "failed";
    }
  }

  // Listen for copy progress events from Rust backend
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    let cancelled = false;

    listen<CopyProgressEvent>("copy-progress", (event) => {
      const { file_path, transfer_id, stage, progress } = event.payload;

      setTransfers(prev => prev.map(t => {
        // Match by transfer_id if available, otherwise fall back to sourcePath.
        // Only update transfers still copying (not cancelled/finished).
        const matches = transfer_id ? t.id === transfer_id : t.sourcePath === file_path;
        if (matches && t.status === "copying") {
          return { ...t, stage, progress, bytesTransferred: progress * (t.fileSize || 1) };
        }
        return t;
      }));
    }).then(fn => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
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

  // Process files in parallel with a concurrency limit, until a conflict is detected.
  async function processFilesInParallel(
    sourcePaths: string[],
    transferIds: string[],
    destinationPath: string,
    fileSizes?: Map<string, number>,
    concurrency: number = 2,
    forceOverwrite: boolean = false
  ) {
    let conflictDetected = false;
    let conflictIndex = -1;
    const completedIndices = new Set<number>();
    const activePromises: Map<number, Promise<void>> = new Map();
    let queueIndex = 0;

    // Process a single file; returns true if it hit an overwrite conflict.
    const processFile = async (sourcePath: string, index: number): Promise<boolean> => {
      const transferId = transferIds[index];
      updateTransfer(transferId, { status: "copying", startTime: Date.now() });

      const outcome = await runCopy(sourcePath, transferId, destinationPath, forceOverwrite);
      if (outcome === "conflict") {
        updateTransfer(transferId, { status: "pending" }); // reset for modal handling
        return true;
      }
      // ok / failed are terminal here; cancelled is left for potential sequential retry (preserved behavior)
      if (outcome === "ok" || outcome === "failed") {
        completedIndices.add(index);
      }
      return false;
    };

    while (queueIndex < sourcePaths.length && !conflictDetected) {
      while (queueIndex < sourcePaths.length && activePromises.size < concurrency && !conflictDetected) {
        const currentIndex = queueIndex++;
        const sourcePath = sourcePaths[currentIndex];

        const promise = processFile(sourcePath, currentIndex).then((hasConflict) => {
          activePromises.delete(currentIndex);
          if (hasConflict && !conflictDetected) {
            conflictDetected = true;
            conflictIndex = currentIndex;
          }
        });
        activePromises.set(currentIndex, promise);
      }

      if (activePromises.size > 0 && !conflictDetected) {
        await Promise.race(Array.from(activePromises.values()));
      }
    }

    // Let in-flight copies settle before handing off to the sequential/modal path.
    if (activePromises.size > 0) {
      await Promise.all(Array.from(activePromises.values()));
    }

    if (conflictDetected && conflictIndex >= 0) {
      const remainingPaths: string[] = [];
      const remainingIds: string[] = [];
      for (let i = conflictIndex; i < sourcePaths.length; i++) {
        if (!completedIndices.has(i)) {
          remainingPaths.push(sourcePaths[i]);
          remainingIds.push(transferIds[i]);
        }
      }

      if (remainingPaths.length > 0) {
        // Sequential processing so the overwrite modal can pause between files.
        await processCopyQueue(remainingPaths, 0, destinationPath, false, fileSizes, false, remainingIds);
        return; // processCopyQueue handles onComplete
      }
    }

    await finishBatch(destinationPath);
  }

  // Sequential copy queue with overwrite-modal handling.
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
      const fileName = baseName(sourcePath);
      const transferId = transferIds?.[i] || `${Date.now()}-${fileName}`;

      if (transferIds?.[i]) {
        updateTransfer(transferId, { status: "copying", startTime: Date.now() });
      } else {
        setTransfers(prev => [...prev, {
          id: transferId,
          fileName,
          fileSize: fileSizes?.get(sourcePath) || 0,
          bytesTransferred: 0,
          status: "copying",
          startTime: Date.now(),
          sourcePath,
        }]);
      }

      const outcome = await runCopy(sourcePath, transferId, destinationPath, forceOverwrite);

      if (outcome === "cancelled") {
        return; // Stop processing the rest of the queue
      }

      if (outcome === "conflict") {
        if (forceSkip) {
          markCancelled(transferId, 'Skipped (file exists)');
          continue;
        }
        // Show modal and pause until the user decides.
        setOverwriteModal({
          isOpen: true,
          fileName,
          sourcePath,
          transferId,
          pendingFiles: sourcePaths,
          currentIndex: i,
          fileSizes,
          transferIds,
          destinationPath,
        });
        return;
      }
      // ok / failed: keep going
    }

    await finishBatch(destinationPath);
  }

  // Entry point: copy files to the pool, asking about conflicts only when the backend reports them.
  async function copyFilesToPool(
    sourcePaths: string[],
    destinationPath: string,
    fileSizes?: Map<string, number>,
    onCopied?: (destPaths: string[]) => void
  ) {
    setIsTransferQueueOpen(true);
    // Start a fresh batch: reset collected dest paths and the per-batch callback.
    copiedDestPathsRef.current = [];
    onCopiedRef.current = onCopied;

    const baseTimestamp = Date.now();
    const transferIds: string[] = [];
    const newTransfers: TransferItem[] = sourcePaths.map((sourcePath, index) => {
      const transferId = `${baseTimestamp}-${index}-${baseName(sourcePath)}`;
      transferIds.push(transferId);
      return {
        id: transferId,
        fileName: baseName(sourcePath),
        fileSize: fileSizes?.get(sourcePath) || 0,
        bytesTransferred: 0,
        status: "pending",
        startTime: baseTimestamp,
        sourcePath,
      };
    });

    setTransfers(prev => [...prev, ...newTransfers]);

    const concurrency = await getConcurrency();
    await processFilesInParallel(sourcePaths, transferIds, destinationPath, fileSizes, concurrency, false);
  }

  // --- Overwrite modal actions ---

  async function handleOverwrite() {
    const { sourcePath, transferId, pendingFiles, currentIndex, fileSizes, transferIds, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    updateTransfer(transferId, { status: "copying", startTime: Date.now() });

    // Copy this file in the background so the queue can keep moving.
    const copyPromise = runCopy(sourcePath, transferId, destinationPath, true);

    await processCopyQueue(pendingFiles, currentIndex + 1, destinationPath, false, fileSizes, false, transferIds);
    await copyPromise;
  }

  async function handleOverwriteAll() {
    const { pendingFiles, fileSizes, transferIds, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    const concurrency = await getConcurrency();
    await processFilesInParallel(pendingFiles, transferIds!, destinationPath, fileSizes, concurrency, true);
  }

  function handleSkip() {
    const { transferId, pendingFiles, currentIndex, fileSizes, transferIds, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    markCancelled(transferId, 'Skipped (file exists)');
    processCopyQueue(pendingFiles, currentIndex + 1, destinationPath, false, fileSizes, false, transferIds);
  }

  async function handleSkipAll() {
    const { transferId, pendingFiles, currentIndex, fileSizes, transferIds, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    markCancelled(transferId, 'Skipped (file exists)');
    await processCopyQueue(pendingFiles, currentIndex + 1, destinationPath, false, fileSizes, true, transferIds);
  }

  function handleCancelImport() {
    const { transferId, transferIds, currentIndex, destinationPath } = overwriteModal;
    setOverwriteModal(prev => ({ ...prev, isOpen: false }));

    // Cancel the current file plus everything still queued behind it.
    const remainingIds = transferIds ? new Set(transferIds.slice(currentIndex)) : new Set([transferId]);
    setTransfers(prev => prev.map(t =>
      remainingIds.has(t.id) && (t.status === "pending" || t.status === "copying")
        ? { ...t, status: "cancelled", error: 'Import cancelled' }
        : t));

    finishBatch(destinationPath);
  }

  async function cancelTransfer(transferId: string) {
    try {
      await invoke("cancel_audio_transfer", { transferId });
    } catch (e) {
      console.error("Failed to cancel transfer:", e);
    }
    setTransfers(prev => prev.map(t =>
      t.id === transferId && (t.status === "copying" || t.status === "pending")
        ? { ...t, status: "cancelled" }
        : t));
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
