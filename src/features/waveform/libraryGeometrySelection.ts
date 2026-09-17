import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryCommittedGeometryRange } from "./WaveformPreview";

export interface LibraryGeometrySelectionTarget {
  rootId: string;
  fileInstanceId: string;
  assetId: string;
}

export interface LibraryGeometryBinding extends LibraryGeometrySelectionTarget {
  selectionGeneration: number;
  range: LibraryCommittedGeometryRange | null;
  /** Sample rate from the waveform that committed this range (for display only). */
  sampleRate: number | null;
}

export interface LibraryGeometryNotification extends LibraryGeometrySelectionTarget {
  selectionGeneration: number;
  range: LibraryCommittedGeometryRange | null;
  sampleRate?: number | null;
}

export function targetsMatch(
  left: LibraryGeometrySelectionTarget | null,
  right: LibraryGeometrySelectionTarget | null,
): boolean {
  if (left === null || right === null) return false;
  return (
    left.rootId === right.rootId
    && left.fileInstanceId === right.fileInstanceId
    && left.assetId === right.assetId
  );
}

/** Accept notify only when identity and selection generation match the active target. */
export function applyGeometryNotification(
  stored: LibraryGeometryBinding | null,
  notification: LibraryGeometryNotification,
  expected: LibraryGeometrySelectionTarget | null,
  expectedGeneration: number,
): LibraryGeometryBinding | null {
  if (expected === null) return null;
  if (!targetsMatch(notification, expected)) return stored;
  if (notification.selectionGeneration !== expectedGeneration) return stored;
  const rate = notification.sampleRate;
  const sampleRate =
    rate !== undefined && rate !== null && Number.isFinite(rate) && rate > 0
      ? Math.trunc(rate)
      : null;
  return {
    rootId: notification.rootId,
    fileInstanceId: notification.fileInstanceId,
    assetId: notification.assetId,
    selectionGeneration: notification.selectionGeneration,
    range: notification.range,
    sampleRate,
  };
}

export function selectEffectiveLibraryRange(
  stored: LibraryGeometryBinding | null,
  expected: LibraryGeometrySelectionTarget | null,
  expectedGeneration: number,
): LibraryCommittedGeometryRange | null {
  if (stored === null || expected === null) return null;
  if (!targetsMatch(stored, expected)) return null;
  if (stored.selectionGeneration !== expectedGeneration) return null;
  return stored.range;
}

export function selectEffectiveLibrarySampleRate(
  stored: LibraryGeometryBinding | null,
  expected: LibraryGeometrySelectionTarget | null,
  expectedGeneration: number,
): number | null {
  if (stored === null || expected === null) return null;
  if (!targetsMatch(stored, expected)) return null;
  if (stored.selectionGeneration !== expectedGeneration) return null;
  return stored.sampleRate;
}

export function useLibraryGeometrySelection(
  target: LibraryGeometrySelectionTarget | null,
) {
  const [stored, setStored] = useState<LibraryGeometryBinding | null>(null);
  const [selectionGeneration, setSelectionGeneration] = useState(0);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    setSelectionGeneration((value) => value + 1);
    setStored(null);
  }, [target?.rootId, target?.fileInstanceId, target?.assetId]);

  const generationRef = useRef(selectionGeneration);
  generationRef.current = selectionGeneration;

  const notifyCommittedGeometryRange = useCallback(
    (notification: LibraryGeometryNotification) => {
      const expected = targetRef.current;
      setStored((prev) => applyGeometryNotification(
        prev,
        notification,
        expected,
        generationRef.current,
      ));
    },
    [],
  );

  const effectiveRange = useMemo(
    () => selectEffectiveLibraryRange(stored, target, selectionGeneration),
    [stored, target, selectionGeneration],
  );

  const effectiveSampleRate = useMemo(
    () => selectEffectiveLibrarySampleRate(stored, target, selectionGeneration),
    [stored, target, selectionGeneration],
  );

  return {
    selectionGeneration,
    effectiveRange,
    effectiveSampleRate,
    notifyCommittedGeometryRange,
  };
}
