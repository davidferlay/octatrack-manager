import { renderHook, act, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useAudioPoolTransfer } from './useAudioPoolTransfer';

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

type CopyBehavior = (sourcePath: string, overwrite: boolean) => Promise<unknown>;

// Wire `invoke` so copy_audio_file_with_progress follows the given behavior and
// the supporting commands return sane defaults.
function mockCopy(behavior: CopyBehavior, concurrency = 2) {
  mockInvoke.mockImplementation(async (cmd, args) => {
    const a = (args ?? {}) as Record<string, unknown>;
    if (cmd === 'get_system_resources') {
      return { cpu_cores: 4, available_memory_mb: 8000, recommended_concurrency: concurrency };
    }
    if (cmd === 'copy_audio_file_with_progress') {
      return behavior(a.sourcePath as string, a.overwrite as boolean);
    }
    if (cmd === 'cancel_audio_transfer') return undefined;
    return undefined;
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockReset();
  mockListen.mockResolvedValue(vi.fn());
});

describe('useAudioPoolTransfer', () => {
  it('copies all files and marks them completed when there is no conflict', async () => {
    mockCopy(() => Promise.resolve());
    const onComplete = vi.fn();
    const { result } = renderHook(() => useAudioPoolTransfer({ onComplete }));

    await act(async () => {
      await result.current.copyFilesToPool(['/a/kick.wav', '/a/snare.wav'], '/dest');
    });

    expect(result.current.transfers).toHaveLength(2);
    expect(result.current.transfers.every(t => t.status === 'completed')).toBe(true);
    expect(result.current.overwriteModal.isOpen).toBe(false);
    expect(onComplete).toHaveBeenCalledWith('/dest');
  });

  it('opens the overwrite modal only when the backend reports the file exists', async () => {
    mockCopy((src, overwrite) =>
      src.includes('kick') && !overwrite
        ? Promise.reject('File already exists: /dest/kick.wav')
        : Promise.resolve()
    );
    const { result } = renderHook(() => useAudioPoolTransfer());

    await act(async () => {
      await result.current.copyFilesToPool(['/a/kick.wav'], '/dest');
    });

    expect(result.current.overwriteModal.isOpen).toBe(true);
    expect(result.current.overwriteModal.fileName).toBe('kick.wav');
  });

  it('handleOverwrite re-copies the conflicting file with overwrite=true', async () => {
    const overwriteFlags: boolean[] = [];
    mockCopy((src, overwrite) => {
      overwriteFlags.push(overwrite);
      return src.includes('kick') && !overwrite
        ? Promise.reject('File already exists: /dest/kick.wav')
        : Promise.resolve();
    });
    const { result } = renderHook(() => useAudioPoolTransfer());

    await act(async () => {
      await result.current.copyFilesToPool(['/a/kick.wav'], '/dest');
    });
    await act(async () => {
      await result.current.handleOverwrite();
    });

    expect(result.current.overwriteModal.isOpen).toBe(false);
    expect(result.current.transfers[0].status).toBe('completed');
    expect(overwriteFlags).toContain(true); // a retry with overwrite happened
  });

  it('handleSkip marks the conflicting file as skipped and continues', async () => {
    mockCopy((src, overwrite) =>
      src.includes('kick') && !overwrite
        ? Promise.reject('File already exists: /dest/kick.wav')
        : Promise.resolve()
    );
    const { result } = renderHook(() => useAudioPoolTransfer());

    await act(async () => {
      await result.current.copyFilesToPool(['/a/kick.wav', '/a/snare.wav'], '/dest');
    });
    await act(async () => {
      result.current.handleSkip();
    });

    const kick = result.current.transfers.find(t => t.fileName === 'kick.wav')!;
    const snare = result.current.transfers.find(t => t.fileName === 'snare.wav')!;
    expect(kick.status).toBe('cancelled');
    expect(kick.error).toMatch(/skipped/i);
    expect(snare.status).toBe('completed');
  });

  it('handleSkipAll skips every remaining conflict', async () => {
    // Both files conflict unless overwritten.
    mockCopy((_src, overwrite) =>
      overwrite ? Promise.resolve() : Promise.reject('File already exists')
    );
    const { result } = renderHook(() => useAudioPoolTransfer());

    await act(async () => {
      await result.current.copyFilesToPool(['/a/a.wav', '/a/b.wav'], '/dest');
    });
    await act(async () => {
      await result.current.handleSkipAll();
    });

    expect(result.current.transfers.every(t => t.status === 'cancelled')).toBe(true);
  });

  it('handleOverwriteAll overwrites every file', async () => {
    mockCopy((_src, overwrite) =>
      overwrite ? Promise.resolve() : Promise.reject('File already exists')
    );
    const { result } = renderHook(() => useAudioPoolTransfer());

    await act(async () => {
      await result.current.copyFilesToPool(['/a/a.wav', '/a/b.wav'], '/dest');
    });
    await act(async () => {
      await result.current.handleOverwriteAll();
    });

    expect(result.current.transfers.every(t => t.status === 'completed')).toBe(true);
  });

  it('handleCancelImport cancels the current and all remaining transfers', async () => {
    mockCopy((_src, overwrite) =>
      overwrite ? Promise.resolve() : Promise.reject('File already exists')
    );
    const { result } = renderHook(() => useAudioPoolTransfer());

    await act(async () => {
      await result.current.copyFilesToPool(['/a/a.wav', '/a/b.wav'], '/dest');
    });
    await act(async () => {
      result.current.handleCancelImport();
    });

    expect(result.current.overwriteModal.isOpen).toBe(false);
    expect(result.current.transfers.every(t => t.status === 'cancelled')).toBe(true);
  });

  it('cancelTransfer signals the backend and marks the transfer cancelled', async () => {
    // Keep the copy pending so the transfer stays in "copying".
    let resolveCopy!: () => void;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_system_resources') return { recommended_concurrency: 1 };
      if (cmd === 'copy_audio_file_with_progress') return new Promise<void>(res => { resolveCopy = res; });
      return undefined;
    });
    const { result } = renderHook(() => useAudioPoolTransfer());

    let pending!: Promise<void>;
    act(() => { pending = result.current.copyFilesToPool(['/a/x.wav'], '/dest'); });
    await waitFor(() => expect(result.current.transfers[0]?.status).toBe('copying'));

    const id = result.current.transfers[0].id;
    await act(async () => { await result.current.cancelTransfer(id); });

    expect(mockInvoke).toHaveBeenCalledWith('cancel_audio_transfer', { transferId: id });
    expect(result.current.transfers[0].status).toBe('cancelled');

    await act(async () => { resolveCopy(); await pending; });
    // A late completion must not resurrect a cancelled transfer.
    expect(result.current.transfers[0].status).toBe('cancelled');
  });

  it('applies copy-progress events to the active transfer', async () => {
    let progressCb: ((e: { payload: Record<string, unknown> }) => void) | undefined;
    mockListen.mockImplementation((_event, cb) => {
      progressCb = cb as unknown as typeof progressCb;
      return Promise.resolve(vi.fn());
    });
    let resolveCopy!: () => void;
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'get_system_resources') return { recommended_concurrency: 1 };
      if (cmd === 'copy_audio_file_with_progress') return new Promise<void>(res => { resolveCopy = res; });
      return undefined;
    });
    const { result } = renderHook(() => useAudioPoolTransfer());

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.copyFilesToPool(['/a/x.wav'], '/dest', new Map([['/a/x.wav', 1000]]));
    });
    await waitFor(() => expect(result.current.transfers[0]?.status).toBe('copying'));

    const id = result.current.transfers[0].id;
    act(() => { progressCb!({ payload: { transfer_id: id, stage: 'converting', progress: 0.5 } }); });

    expect(result.current.transfers[0].progress).toBe(0.5);
    expect(result.current.transfers[0].bytesTransferred).toBe(500);

    await act(async () => { resolveCopy(); await pending; });
    expect(result.current.transfers[0].status).toBe('completed');
  });

  describe('race regressions', () => {
    it('copies each file exactly once per drop (no duplicate transfers)', async () => {
      const copyCalls: string[] = [];
      mockCopy((src) => { copyCalls.push(src); return Promise.resolve(); });
      const { result } = renderHook(() => useAudioPoolTransfer());

      await act(async () => {
        await result.current.copyFilesToPool(['/a/x.wav', '/a/y.wav'], '/dest');
      });

      expect(copyCalls.filter(p => p === '/a/x.wav')).toHaveLength(1);
      expect(copyCalls.filter(p => p === '/a/y.wav')).toHaveLength(1);
      expect(result.current.transfers).toHaveLength(2);
    });

    it('never shows the overwrite modal when the backend reports no conflict (false-positive regression)', async () => {
      // Files that do NOT exist at the destination must never trigger the modal,
      // even when processed concurrently. This is the false-positive bug guard.
      mockCopy(() => Promise.resolve(), 4);
      const { result } = renderHook(() => useAudioPoolTransfer());

      await act(async () => {
        await result.current.copyFilesToPool(['/a/cave.wav', '/a/celebrate.wav'], '/dest');
      });

      expect(result.current.overwriteModal.isOpen).toBe(false);
      expect(result.current.transfers.every(t => t.status === 'completed')).toBe(true);
    });

    it('cleans up the progress listener even if listen resolves after unmount (StrictMode race)', async () => {
      // The duplicate-transfer bug came from a ghost listener: cleanup ran before
      // listen() resolved, so the first unlisten was never called. The cancelled-flag
      // pattern must invoke the unlisten fn that resolves post-unmount.
      let resolveListen!: (fn: () => void) => void;
      const unlistenSpy = vi.fn();
      mockListen.mockImplementation(() => new Promise(res => { resolveListen = res; }));
      mockInvoke.mockResolvedValue(undefined);

      const { unmount } = renderHook(() => useAudioPoolTransfer());
      unmount(); // cleanup runs while listen() is still pending (unlisten undefined)

      await act(async () => {
        resolveListen(unlistenSpy); // resolves after unmount
        await Promise.resolve();
      });

      expect(unlistenSpy).toHaveBeenCalledTimes(1);
    });
  });
});
