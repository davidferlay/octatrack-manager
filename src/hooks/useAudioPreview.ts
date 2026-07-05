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

// Sample preview via the Web Audio API. We decode the file bytes once into a PCM
// AudioBuffer and play it through an AudioBufferSourceNode + GainNode. Seeking restarts
// the source at a new offset instead of seeking a live demuxer — on WebKitGTK, seeking a
// Blob-backed <audio> element corrupts 24-bit WAV decoding into white noise; decoding
// up front sidesteps that pipeline entirely.
export function useAudioPreview(): AudioPreview {
  const ctxRef = useRef<AudioContext | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const offsetRef = useRef(0)       // buffer position (s) where the current playback started
  const startedAtRef = useRef(0)    // ctx.currentTime when the current source started
  const rafRef = useRef<number | null>(null)
  const stoppingRef = useRef(false) // true while we deliberately stop a source (suppresses onended)

  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [activeName, setActiveName] = useState('')
  const [error, setError] = useState(false)
  const [volume, setVolumeState] = useState(loadVolume)
  const [autoPreview, setAutoPreviewState] = useState(loadAutoPreview)
  const [loop, setLoopState] = useState(loadLoop)
  const volumeRef = useRef(volume)
  const loopRef = useRef(loop)

  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctor = getAudioContextCtor()
      const ctx = new Ctor()
      const gain = ctx.createGain()
      gain.gain.value = volumeRef.current
      gain.connect(ctx.destination)
      ctxRef.current = ctx
      gainRef.current = gain
    }
    return ctxRef.current
  }, [])

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  const startRaf = useCallback(() => {
    stopRaf()
    const loop = () => {
      const ctx = ctxRef.current
      const buf = bufferRef.current
      if (ctx && buf) {
        setCurrentTime(Math.min(buf.duration, offsetRef.current + (ctx.currentTime - startedAtRef.current)))
      }
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }, [stopRaf])

  const stopPlayback = useCallback((remember: boolean) => {
    const ctx = ctxRef.current
    if (sourceRef.current) {
      if (remember && ctx) {
        const t = Math.min(bufferRef.current?.duration ?? 0, offsetRef.current + (ctx.currentTime - startedAtRef.current))
        offsetRef.current = t
        setCurrentTime(t)
      }
      stoppingRef.current = true
      try { sourceRef.current.stop() } catch { /* already stopped */ }
      sourceRef.current.disconnect()
      sourceRef.current = null
      stoppingRef.current = false
    }
    stopRaf()
  }, [stopRaf])

  const startPlayback = useCallback((offset: number) => {
    const buffer = bufferRef.current
    if (!buffer) return
    const ctx = getCtx()
    ctx.resume()
    stopPlayback(false)
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(gainRef.current!)
    src.onended = () => {
      if (stoppingRef.current) return // our own stop(), not a natural end
      sourceRef.current = null
      if (loopRef.current && bufferRef.current) { startPlayback(0); return }
      offsetRef.current = 0
      setIsPlaying(false)
      setCurrentTime(0)
      stopRaf()
    }
    const startOffset = offset >= buffer.duration ? 0 : Math.max(0, offset)
    offsetRef.current = startOffset
    startedAtRef.current = ctx.currentTime
    src.start(0, startOffset)
    sourceRef.current = src
    setIsPlaying(true)
    startRaf()
  }, [getCtx, stopPlayback, startRaf, stopRaf])

  // Fetch the file bytes via Rust and decode them into a PCM buffer.
  const decode = useCallback(async (path: string, name: string): Promise<boolean> => {
    setError(false)
    setActiveName(name)
    try {
      const ctx = getCtx()
      const bytes = await invoke<ArrayBuffer>('read_audio_file', { path })
      const buffer = await decodeBytes(ctx, bytes)
      bufferRef.current = buffer
      offsetRef.current = 0
      setDuration(buffer.duration)
      setCurrentTime(0)
      return true
    } catch {
      bufferRef.current = null
      setError(true)
      setIsPlaying(false)
      return false
    }
  }, [getCtx])

  const play = useCallback(async (path: string, name: string) => {
    // Resume while still inside the user-gesture call stack: WebView2 (Chromium autoplay
    // policy) and WebKit can refuse a resume() issued after an await, which left the
    // context suspended and playback silent.
    try { getCtx().resume() } catch { /* surfaces via decode() below */ }
    stopPlayback(false)
    setIsPlaying(false)
    if (await decode(path, name)) startPlayback(0)
  }, [getCtx, decode, startPlayback, stopPlayback])

  const load = useCallback((path: string, name: string) => {
    stopPlayback(false)
    setIsPlaying(false)
    decode(path, name)
  }, [decode, stopPlayback])

  // Return to the idle state (no sample): used when the selection isn't a previewable file.
  const reset = useCallback(() => {
    stopPlayback(false)
    bufferRef.current = null
    offsetRef.current = 0
    setIsPlaying(false)
    setActiveName('')
    setDuration(0)
    setCurrentTime(0)
    setError(false)
  }, [stopPlayback])

  const pause = useCallback(() => { stopPlayback(true); setIsPlaying(false) }, [stopPlayback])

  const togglePlay = useCallback(() => {
    if (sourceRef.current) { stopPlayback(true); setIsPlaying(false) }
    else if (bufferRef.current) startPlayback(offsetRef.current)
  }, [stopPlayback, startPlayback])

  // Seek by restarting the buffer at the new offset (only audible while playing).
  // ponytail: a drag fires many seeks → many restarts; fine for a preview, debounce only if it stutters.
  const seek = useCallback((seconds: number) => {
    const dur = bufferRef.current?.duration ?? 0
    const t = Math.min(dur, Math.max(0, seconds))
    offsetRef.current = t
    setCurrentTime(t)
    if (sourceRef.current) startPlayback(t)
  }, [startPlayback])

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    volumeRef.current = v
    if (gainRef.current) gainRef.current.gain.value = v
    localStorage.setItem(VOL_KEY, String(v))
  }, [])
  const setAutoPreview = useCallback((b: boolean) => { setAutoPreviewState(b); localStorage.setItem(AUTO_KEY, String(b)) }, [])
  const setLoop = useCallback((b: boolean) => { setLoopState(b); loopRef.current = b; localStorage.setItem(LOOP_KEY, String(b)) }, [])

  useEffect(() => {
    return () => { stopPlayback(false); stopRaf(); ctxRef.current?.close() }
  }, [stopPlayback, stopRaf])

  return { isPlaying, currentTime, duration, activeName, error, volume, autoPreview, loop,
    play, load, reset, pause, togglePlay, seek, setVolume, setAutoPreview, setLoop }
}
