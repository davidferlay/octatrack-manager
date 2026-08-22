import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { useAudioPreview, shouldAutoPreview, formatTime, scrubTarget, volumeStep, isAudioFile, getAudioContextCtor, decodeBytes, toArrayBuffer, encodeWav } from './useAudioPreview'

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

// Old WKWebView (macOS Mojave and earlier Safari) only exposes webkitAudioContext and a
// callback-only decodeAudioData - the compat shims must handle both shapes.
describe('legacy WebKit compatibility', () => {
  const g = globalThis as unknown as { AudioContext?: unknown; webkitAudioContext?: unknown }

  it('getAudioContextCtor falls back to webkitAudioContext when AudioContext is missing', () => {
    const saved = g.AudioContext
    class Prefixed {}
    delete g.AudioContext
    g.webkitAudioContext = Prefixed
    try {
      expect(getAudioContextCtor()).toBe(Prefixed)
    } finally {
      g.AudioContext = saved
      delete g.webkitAudioContext
    }
  })

  it('getAudioContextCtor throws when no implementation exists', () => {
    const saved = g.AudioContext
    delete g.AudioContext
    try {
      expect(() => getAudioContextCtor()).toThrow('Web Audio API not available')
    } finally {
      g.AudioContext = saved
    }
  })

  it('decodeBytes resolves with a callback-only decodeAudioData (old WebKit)', async () => {
    const buffer = { duration: 2 }
    const ctx = {
      decodeAudioData: (_b: ArrayBuffer, ok: (b: unknown) => void) => { ok(buffer) }, // no returned promise
    } as unknown as AudioContext
    await expect(decodeBytes(ctx, new ArrayBuffer(4))).resolves.toBe(buffer)
  })

  it('decodeBytes rejects with a callback-only decodeAudioData on error', async () => {
    const ctx = {
      decodeAudioData: (_b: ArrayBuffer, _ok: unknown, err: (e: unknown) => void) => { err(new Error('bad data')) },
    } as unknown as AudioContext
    await expect(decodeBytes(ctx, new ArrayBuffer(4))).rejects.toThrow('bad data')
  })

  it('decodeBytes resolves with a promise-returning decodeAudioData (modern engines)', async () => {
    const buffer = { duration: 3 }
    const ctx = {
      decodeAudioData: () => Promise.resolve(buffer), // ignores callbacks, like some mocks/engines
    } as unknown as AudioContext
    await expect(decodeBytes(ctx, new ArrayBuffer(4))).resolves.toBe(buffer)
  })

  it('decodeBytes rejects with a promise-returning decodeAudioData on error', async () => {
    const ctx = {
      decodeAudioData: () => Promise.reject(new Error('undecodable')),
    } as unknown as AudioContext
    await expect(decodeBytes(ctx, new ArrayBuffer(4))).rejects.toThrow('undecodable')
  })
})

// When Tauri's custom-protocol IPC fails (seen on older WKWebView, e.g. macOS Mojave),
// it falls back to postMessage IPC where a raw Vec<u8> response arrives as a plain JSON
// number array instead of an ArrayBuffer.
describe('toArrayBuffer', () => {
  it('passes an ArrayBuffer through untouched', () => {
    const buf = new ArrayBuffer(4)
    expect(toArrayBuffer(buf)).toBe(buf)
  })

  it('converts a number array (tauri postMessage IPC fallback) to an ArrayBuffer', () => {
    const out = toArrayBuffer([82, 73, 70, 70])
    expect(out).toBeInstanceOf(ArrayBuffer)
    expect(Array.from(new Uint8Array(out))).toEqual([82, 73, 70, 70])
  })
})

// Playback goes through an <audio> element (WebKitGTK's Web Audio output is silent on
// Bluetooth and, with the audio mixer forced on to work around that, distorts every
// output). We still decode with decodeAudioData, then hand the element 16-bit PCM we
// encoded ourselves - so the element never demuxes a 24-bit file, which is what used to
// corrupt seeks into white noise on older WebKit.
describe('encodeWav', () => {
  const src = (channels: number[][], sampleRate = 44100) => ({
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData: (i: number) => Float32Array.from(channels[i]),
  })

  // jsdom's Blob has no arrayBuffer(); FileReader is implemented.
  const bytes = (blob: Blob) => new Promise<Uint8Array>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
  const str = (b: Uint8Array, o: number, n: number) =>
    String.fromCharCode(...Array.from(b.slice(o, o + n)))
  const u32 = (b: Uint8Array, o: number) => new DataView(b.buffer).getUint32(o, true)
  const u16 = (b: Uint8Array, o: number) => new DataView(b.buffer).getUint16(o, true)
  const i16 = (b: Uint8Array, o: number) => new DataView(b.buffer).getInt16(o, true)

  it('writes a PCM RIFF/WAVE header describing the source', async () => {
    const b = await bytes(encodeWav(src([[0, 0, 0]], 48000)))
    expect(str(b, 0, 4)).toBe('RIFF')
    expect(str(b, 8, 4)).toBe('WAVE')
    expect(str(b, 12, 4)).toBe('fmt ')
    expect(u32(b, 16)).toBe(16)   // PCM fmt chunk size
    expect(u16(b, 20)).toBe(1)    // format 1 = PCM
    expect(u16(b, 22)).toBe(1)    // channels
    expect(u32(b, 24)).toBe(48000)
    expect(u16(b, 34)).toBe(16)   // bits per sample
    expect(str(b, 36, 4)).toBe('data')
  })

  it('sizes the header fields to the payload', async () => {
    const b = await bytes(encodeWav(src([[0, 0, 0], [0, 0, 0]], 44100)))
    const dataBytes = 3 * 2 * 2 // frames * channels * 2 bytes
    expect(u32(b, 40)).toBe(dataBytes)
    expect(u32(b, 4)).toBe(36 + dataBytes) // RIFF size = header remainder + data
    expect(u16(b, 32)).toBe(4)             // block align = channels * 2
    expect(u32(b, 28)).toBe(44100 * 4)     // byte rate
    expect(b.length).toBe(44 + dataBytes)
  })

  it('converts float samples to 16-bit and clamps out-of-range values', async () => {
    const b = await bytes(encodeWav(src([[0, 1, -1, 2, -2, 0.5]])))
    expect(i16(b, 44)).toBe(0)
    expect(i16(b, 46)).toBe(32767)
    expect(i16(b, 48)).toBe(-32768)
    expect(i16(b, 50)).toBe(32767)   // clamped, must not wrap round to negative
    expect(i16(b, 52)).toBe(-32768)  // clamped
    expect(i16(b, 54)).toBe(16383)   // 0.5 * 32767, truncated
  })

  it('interleaves channels frame by frame', async () => {
    const b = await bytes(encodeWav(src([[1, 1, 1], [-1, -1, -1]])))
    expect(i16(b, 44)).toBe(32767)   // frame 0 left
    expect(i16(b, 46)).toBe(-32768)  // frame 0 right
    expect(i16(b, 48)).toBe(32767)   // frame 1 left
    expect(i16(b, 50)).toBe(-32768)  // frame 1 right
  })

  it('produces an audio/wav blob', () => {
    expect(encodeWav(src([[0]])).type).toBe('audio/wav')
  })
})

describe('useAudioPreview', () => {
  it('play succeeds when invoke returns a number array (postMessage IPC fallback)', async () => {
    vi.mocked(invoke).mockResolvedValue([82, 73, 70, 70])
    const { result } = renderHook(() => useAudioPreview())
    await act(async () => { await result.current.play('/set/AUDIO/kick.wav', 'kick.wav') })
    expect(result.current.error).toBe(false)
    expect(result.current.activeName).toBe('kick.wav')
  })

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

  it('setLoop persists to localStorage', () => {
    const { result } = renderHook(() => useAudioPreview())
    act(() => result.current.setLoop(true))
    expect(result.current.loop).toBe(true)
    expect(localStorage.getItem('otm.preview.loop')).toBe('true')
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
