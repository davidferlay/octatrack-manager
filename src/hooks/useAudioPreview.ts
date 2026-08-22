import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

const VOL_KEY = 'otm.preview.volume'
const AUTO_KEY = 'otm.preview.autoPreview'
const LOOP_KEY = 'otm.preview.loop'

export function shouldAutoPreview(autoPreview: boolean, selectionSize: number, playable: boolean): boolean {
  return autoPreview && selectionSize === 1 && playable
}

// Extensions we attempt to preview. Anything else is never read/decoded, so selecting
// a huge non-audio file (e.g. a 400 MB tar.gz) can't freeze the UI on a pointless read.
const AUDIO_EXTENSIONS = new Set([
  'wav', 'wave', 'aif', 'aiff', 'aifc', 'flac', 'mp3', 'ogg', 'oga', 'opus', 'm4a', 'aac',
])
export function isAudioFile(path: string): boolean {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return false
  return AUDIO_EXTENSIONS.has(path.slice(dot + 1).toLowerCase())
}

// Keyboard scrub: move the playhead by 5% of total duration, clamped to the clip.
export function scrubTarget(currentTime: number, duration: number, dir: 1 | -1): number {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, currentTime)
  const next = currentTime + dir * duration * 0.05
  return Math.min(duration, Math.max(0, next))
}

// Keyboard volume: step by 5%, clamped to [0, 1], rounded to avoid float drift.
export function volumeStep(volume: number, dir: 1 | -1): number {
  const next = Math.min(1, Math.max(0, volume + dir * 0.05))
  return Math.round(next * 100) / 100
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Older WebKit (WKWebView up to Safari 14.0, e.g. macOS Mojave) only exposes the
// prefixed constructor.
export function getAudioContextCtor(): typeof AudioContext {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  const Ctor = w.AudioContext ?? w.webkitAudioContext
  if (!Ctor) throw new Error('Web Audio API not available')
  return Ctor
}

// decodeAudioData: older WebKit only implements the callback signature (no returned
// promise); modern engines support both. Wire up both and let the Promise ignore the
// duplicate settle.
export function decodeBytes(ctx: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const p = ctx.decodeAudioData(bytes, resolve, reject) as Promise<AudioBuffer> | undefined
    p?.then(resolve, reject)
  })
}

// Raw invoke responses arrive as ArrayBuffer over Tauri's custom-protocol IPC, but Tauri
// silently falls back to postMessage IPC when that fetch fails (seen on older WKWebView,
// e.g. macOS Mojave) — there a raw Vec<u8> response arrives as a plain JSON number array.
export function toArrayBuffer(data: ArrayBuffer | number[]): ArrayBuffer {
  return data instanceof ArrayBuffer ? data : new Uint8Array(data).buffer
}

/** Minimal shape of the decoded PCM we re-encode - an AudioBuffer satisfies it. */
export interface PcmSource {
  numberOfChannels: number
  sampleRate: number
  length: number
  getChannelData(channel: number): Float32Array
}

// Re-encode decoded PCM as a 16-bit WAV so playback can go through an <audio> element.
// The element then only ever demuxes plain 16-bit PCM that we wrote: on older WebKit,
// seeking a Blob-backed element holding a 24-bit WAV corrupted decoding into white noise,
// and this sidesteps that pipeline whatever the source file's bit depth was.
export function encodeWav(buffer: PcmSource): Blob {
  const channels = Math.max(1, buffer.numberOfChannels)
  const frames = buffer.length
  const blockAlign = channels * 2
  const dataBytes = frames * blockAlign
  const out = new DataView(new ArrayBuffer(44 + dataBytes))

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  out.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  out.setUint32(16, 16, true)                          // PCM chunk size
  out.setUint16(20, 1, true)                           // format: PCM
  out.setUint16(22, channels, true)
  out.setUint32(24, buffer.sampleRate, true)
  out.setUint32(28, buffer.sampleRate * blockAlign, true)
  out.setUint16(32, blockAlign, true)
  out.setUint16(34, 16, true)                          // bits per sample
  ascii(36, 'data')
  out.setUint32(40, dataBytes, true)

  const data: Float32Array[] = []
  for (let c = 0; c < channels; c++) data.push(buffer.getChannelData(c))

  let offset = 44
  for (let frame = 0; frame < frames; frame++) {
    for (let c = 0; c < channels; c++) {
      // Clamp before scaling: decoded float PCM can exceed +-1, and letting it wrap
      // would turn a loud peak into the opposite-polarity sample - audible as a click.
      const sample = Math.max(-1, Math.min(1, data[c][frame] ?? 0))
      out.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([out.buffer], { type: 'audio/wav' })
}

function loadVolume(): number {
  const v = parseFloat(localStorage.getItem(VOL_KEY) ?? '')
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.8
}

function loadAutoPreview(): boolean {
  return localStorage.getItem(AUTO_KEY) === 'true'
}

function loadLoop(): boolean {
  return localStorage.getItem(LOOP_KEY) === 'true'
}

export interface AudioPreview {
  isPlaying: boolean
  currentTime: number
  duration: number
  activeName: string
  error: boolean
  errorDetail: string
  volume: number
  autoPreview: boolean
  loop: boolean
  play: (path: string, name: string) => void
  load: (path: string, name: string) => void
  reset: () => void
  pause: () => void
  togglePlay: () => void
  seek: (seconds: number) => void
  setVolume: (v: number) => void
  setAutoPreview: (b: boolean) => void
  setLoop: (b: boolean) => void
}

// Sample preview. We decode the file bytes once with decodeAudioData, re-encode the
// result as 16-bit PCM (see encodeWav) and play that through an <audio> element.
//
// Why not play the decoded buffer through Web Audio, which is the obvious route: on
// WebKitGTK its output is silent on Bluetooth (A2DP) sinks, and the documented
// workaround - forcing WebKit's GStreamer audio mixer - distorts every output on the
// machine (issues #7 and #9). An <audio> element measures clean on both.
//
// Why decode at all instead of handing the element the original file: seeking a
// Blob-backed element holding a 24-bit WAV used to corrupt decoding into white noise on
// WebKitGTK. Re-encoding means the element only ever sees plain 16-bit PCM we wrote.
export function useAudioPreview(): AudioPreview {
  const ctxRef = useRef<AudioContext | null>(null)     // decoding only, never output
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const durationRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [activeName, setActiveName] = useState('')
  const [error, setError] = useState(false)
  const [errorDetail, setErrorDetail] = useState('')
  const [volume, setVolumeState] = useState(loadVolume)
  const [autoPreview, setAutoPreviewState] = useState(loadAutoPreview)
  const [loop, setLoopState] = useState(loadLoop)
  const volumeRef = useRef(volume)
  const loopRef = useRef(loop)

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = getAudioContextCtor()
      ctxRef.current = new Ctor()
    }
    return ctxRef.current
  }, [])

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const startRaf = useCallback(() => {
    stopRaf()
    const tick = () => {
      const el = audioRef.current
      if (el) setCurrentTime(el.currentTime)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [stopRaf])

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      const el = new Audio()
      el.volume = volumeRef.current
      el.loop = loopRef.current
      // With loop set the element repeats without firing 'ended', so this only runs on a
      // genuine end-of-clip.
      el.addEventListener('ended', () => {
        setIsPlaying(false)
        setCurrentTime(0)
        stopRaf()
      })
      audioRef.current = el
    }
    return audioRef.current
  }, [stopRaf])

  // currentTime is only writable once the element has metadata; before that, defer.
  const seekElement = useCallback((el: HTMLAudioElement, seconds: number) => {
    const apply = () => { try { el.currentTime = seconds } catch { /* not seekable */ } }
    if (el.readyState >= 1 /* HAVE_METADATA */) apply()
    else el.addEventListener('loadedmetadata', apply, { once: true })
  }, [])

  const startPlayback = useCallback((offset: number) => {
    const el = audioRef.current
    if (!el || !el.src) return
    const target = offset >= durationRef.current ? 0 : Math.max(0, offset)
    seekElement(el, target)
    setCurrentTime(target)
    const started = el.play()
    setIsPlaying(true)
    startRaf()
    // play() rejects when the engine refuses (autoplay policy, decode failure). Surface it
    // instead of leaving a transport that claims to be playing in silence.
    void Promise.resolve(started).catch((e: unknown) => {
      console.error('audio playback failed', e)
      setIsPlaying(false)
      stopRaf()
      setError(true)
      setErrorDetail(String(e))
    })
  }, [seekElement, startRaf, stopRaf])

  const stopPlayback = useCallback((remember: boolean) => {
    const el = audioRef.current
    if (el) {
      el.pause()
      if (remember) setCurrentTime(el.currentTime)
    }
    stopRaf()
  }, [stopRaf])

  // Fetch the file bytes via Rust, decode them, and hand the element 16-bit PCM.
  const decode = useCallback(async (path: string, name: string): Promise<boolean> => {
    setError(false)
    setErrorDetail('')
    setActiveName(name)
    try {
      const ctx = getCtx()
      const bytes = await invoke<ArrayBuffer | number[]>('read_audio_file', { path })
      const buffer = await decodeBytes(ctx, toArrayBuffer(bytes))
      const el = getAudio()
      el.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = URL.createObjectURL(encodeWav(buffer))
      el.src = urlRef.current
      durationRef.current = buffer.duration
      setDuration(buffer.duration)
      setCurrentTime(0)
      return true
    } catch (e) {
      console.error('audio preview failed', path, e)
      durationRef.current = 0
      setError(true)
      setErrorDetail(String(e))
      setIsPlaying(false)
      return false
    }
  }, [getCtx, getAudio])

  const play = useCallback(async (path: string, name: string) => {
    stopPlayback(false)
    setIsPlaying(false)
    if (await decode(path, name)) startPlayback(0)
  }, [decode, startPlayback, stopPlayback])

  const load = useCallback((path: string, name: string) => {
    stopPlayback(false)
    setIsPlaying(false)
    decode(path, name)
  }, [decode, stopPlayback])

  // Return to the idle state (no sample): used when the selection isn't a previewable file.
  const reset = useCallback(() => {
    stopPlayback(false)
    const el = audioRef.current
    if (el) el.removeAttribute('src')
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    durationRef.current = 0
    setIsPlaying(false)
    setActiveName('')
    setDuration(0)
    setCurrentTime(0)
    setError(false)
    setErrorDetail('')
  }, [stopPlayback])

  const pause = useCallback(() => { stopPlayback(true); setIsPlaying(false) }, [stopPlayback])

  const togglePlay = useCallback(() => {
    const el = audioRef.current
    if (!el || !el.src) return
    if (el.paused) startPlayback(el.currentTime)
    else { stopPlayback(true); setIsPlaying(false) }
  }, [startPlayback, stopPlayback])

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current
    const t = Math.min(durationRef.current, Math.max(0, seconds))
    setCurrentTime(t)
    if (el && el.src) seekElement(el, t)
  }, [seekElement])

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    volumeRef.current = v
    if (audioRef.current) audioRef.current.volume = v
    localStorage.setItem(VOL_KEY, String(v))
  }, [])
  const setAutoPreview = useCallback((b: boolean) => { setAutoPreviewState(b); localStorage.setItem(AUTO_KEY, String(b)) }, [])
  const setLoop = useCallback((b: boolean) => {
    setLoopState(b)
    loopRef.current = b
    if (audioRef.current) audioRef.current.loop = b
    localStorage.setItem(LOOP_KEY, String(b))
  }, [])

  useEffect(() => {
    return () => {
      audioRef.current?.pause()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      stopRaf()
      ctxRef.current?.close()
    }
  }, [stopRaf])

  return { isPlaying, currentTime, duration, activeName, error, errorDetail, volume, autoPreview, loop,
    play, load, reset, pause, togglePlay, seek, setVolume, setAutoPreview, setLoop }
}
