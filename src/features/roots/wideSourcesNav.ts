export type WideSourcesNavSnapshot = boolean | null;

export interface WideSourcesNavState {
  catalogReady: boolean;
  narrowActive: boolean;
  wasNarrow: boolean;
  navigationOpen: boolean;
  recordedWideOpen: WideSourcesNavSnapshot;
}

export interface WideSourcesNavNext {
  nextOpen: boolean;
  recordedWideOpen: WideSourcesNavSnapshot;
  wasNarrow: boolean;
}

/** Distinguishes unrecorded wide nav (null) from user-closed (false). */
export function applyWideSourcesNavTransition(input: WideSourcesNavState): WideSourcesNavNext {
  if (!input.catalogReady) {
    return {
      nextOpen: input.navigationOpen,
      recordedWideOpen: input.recordedWideOpen,
      wasNarrow: input.wasNarrow,
    };
  }

  if (input.narrowActive) {
    if (!input.wasNarrow) {
      return {
        nextOpen: false,
        recordedWideOpen: input.recordedWideOpen,
        wasNarrow: true,
      };
    }
    return {
      nextOpen: input.navigationOpen,
      recordedWideOpen: input.recordedWideOpen,
      wasNarrow: true,
    };
  }

  if (input.wasNarrow) {
    return {
      nextOpen: input.recordedWideOpen ?? true,
      recordedWideOpen: input.recordedWideOpen,
      wasNarrow: false,
    };
  }

  return {
    nextOpen: input.navigationOpen,
    recordedWideOpen: input.navigationOpen,
    wasNarrow: false,
  };
}

export function resetWideSourcesNav(): WideSourcesNavNext {
  return {
    nextOpen: true,
    recordedWideOpen: null,
    wasNarrow: false,
  };
}
