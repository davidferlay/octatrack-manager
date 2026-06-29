import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { useAudioPreview, shouldAutoPreview, formatTime, scrubTarget, volumeStep, isAudioFile } from './useAudioPreview'

beforeEach(() => {
  localStorage.clear()
  vi.mocked(invoke).mockReset()
  vi.mocked(invoke).mockResolvedValue(new ArrayBuffer(8))
})

describe('shouldAutoPreview', () => {
  it('plays only when on, single-select, and playable', () => {
    expect(shouldAutoPreview(true, 1, true)).toBe(true)
    expect(shouldAutoPreview(false, 1, true)).toBe(false)
    expect(shouldAutoPreview(true, 2, true)).toBe(false)
    expect(shouldAutoPreview(true, 1, false)).toBe(false)
  })
})

describe('isAudioFile', () => {
  it('accepts common audio extensions, rejects everything else', () => {
    expect(isAudioFile('/x/Atmosphere  5 - A.wav')).toBe(true)
    expect(isAudioFile('/x/loop.AIFF')).toBe(true)
    expect(isAudioFile('/x/take.flac')).toBe(true)
    expect(isAudioFile('/x/huge.tar.gz')).toBe(false)
    expect(isAudioFile('/x/archive.zip')).toBe(false)
    expect(isAudioFile('/x/noext')).toBe(false)
  })
})

describe('scrubTarget', () => {
  it('moves by 5% of duration and clamps to the clip', () => {
    expect(scrubTarget(10, 100, 1)).toBe(15)
    expect(scrubTarget(10, 100, -1)).toBe(5)
    expect(scrubTarget(98, 100, 1)).toBe(100)
    expect(scrubTarget(2, 100, -1)).toBe(0)
  })
  it('is a no-op when duration is unknown', () => {
    expect(scrubTarget(0, 0, 1)).toBe(0)
    expect(scrubTarget(3, NaN, -1)).toBe(3)
  })
})

describe('volumeStep', () => {
  it('steps by 5% and clamps to [0,1]', () => {
    expect(volumeStep(0.8, 1)).toBe(0.85)
    expect(volumeStep(0.8, -1)).toBe(0.75)
    expect(volumeStep(0.98, 1)).toBe(1)
    expect(volumeStep(0.02, -1)).toBe(0)
  })
})

describe('formatTime', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(5)).toBe('0:05')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(NaN)).toBe('0:00')
  })
})

describe('useAudioPreview', () => {
  it('play reads the file bytes via read_audio_file and sets the active name', async () => {
    const { result } = renderHook(() => useAudioPreview())
    await act(async () => { await result.current.play('/set/AUDIO/kick.wav', 'kick.wav') })
    expect(invoke).toHaveBeenCalledWith('read_audio_file', { path: '/set/AUDIO/kick.wav' })
    expect(result.current.activeName).toBe('kick.wav')
  })

  it('setVolume persists to localStorage', () => {
    const { result } = renderHook(() => useAudioPreview())
    act(() => result.current.setVolume(0.3))
    expect(result.current.volume).toBe(0.3)
    expect(localStorage.getItem('otm.preview.volume')).toBe('0.3')
  })

  it('setAutoPreview persists to localStorage', () => {
    const { result } = renderHook(() => useAudioPreview())
    act(() => result.current.setAutoPreview(true))
    expect(result.current.autoPreview).toBe(true)
    expect(localStorage.getItem('otm.preview.autoPreview')).toBe('true')
  })

  it('reads persisted volume on init', () => {
    localStorage.setItem('otm.preview.volume', '0.5')
    const { result } = renderHook(() => useAudioPreview())
    expect(result.current.volume).toBe(0.5)
  })

  it('load reads bytes and sets activeName without starting playback', async () => {
    const { result } = renderHook(() => useAudioPreview())
    await act(async () => { await result.current.load('/set/AUDIO/snare.wav', 'snare.wav') })
    expect(invoke).toHaveBeenCalledWith('read_audio_file', { path: '/set/AUDIO/snare.wav' })
    expect(result.current.activeName).toBe('snare.wav')
    expect(result.current.isPlaying).toBe(false)
  })
})
