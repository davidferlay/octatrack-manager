import { AudioPreview, formatTime } from '../hooks/useAudioPreview'
import './SamplePlayerBar.css'

interface Props {
  player: AudioPreview
  playable: boolean
  // When a side pane is shown, horizontal room is tight — shorten LOOP/AUTO to L/A.
  compact?: boolean
}

export function SamplePlayerBar({ player, playable, compact = false }: Props) {
  const { isPlaying, currentTime, duration, activeName, error, errorDetail, volume, autoPreview, loop,
    togglePlay, seek, setVolume, setAutoPreview, setLoop } = player
  const hasSample = !!activeName
  const canPlay = playable && !error
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const volumePct = Math.round(volume * 100)

  const nudgeVolume = (delta: number) => setVolume(Math.min(1, Math.max(0, Math.round((volume + delta) * 100) / 100)))

  // Drag up/down over the VOL readout to change volume (full range over ~150px); wheel also works.
  const onVolumePointerDown = (e: React.PointerEvent) => {
    e.preventDefault()
    const startY = e.clientY
    const startVol = volume
    const onMove = (ev: PointerEvent) => {
      const next = Math.min(1, Math.max(0, startVol + (startY - ev.clientY) / 150))
      setVolume(Math.round(next * 100) / 100)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return (
    <div className={`sample-player-bar${hasSample ? '' : ' idle'}`}>
      {hasSample && (
        <>
          <button className="player-play-btn" aria-label={isPlaying ? 'Pause' : 'Play'}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'} disabled={!canPlay} onClick={togglePlay}>
            {isPlaying
              ? <span className="player-pause-icon" aria-hidden="true"><span /><span /></span>
              : <i className="fas fa-play" />}
          </button>

          <span className="player-name" title={error ? errorDetail || "Can't play this file" : activeName}>
            {error ? "Can't play" : activeName}
          </span>

          <div className="player-seek-track" title="Seek through the sample (Ctrl+Left/Right to scrub)">
            <div className="player-seek-line" />
            <div className="player-seek-fill" style={{ width: `${progress}%` }} />
            <div className="player-seek-head" style={{ left: `${progress}%` }} />
            <input className="player-seek-input" type="range" aria-label="Seek"
              min={0} max={duration || 0} step={0.01} value={currentTime}
              disabled={!canPlay} onChange={(e) => seek(Number(e.target.value))} />
          </div>

          <span className="player-time" title="Elapsed / total duration">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <span className="player-vol" aria-label="Volume" role="slider"
            aria-valuenow={volumePct} aria-valuemin={0} aria-valuemax={100}
            title="Volume (drag up/down, scroll, or Ctrl+Up/Down)"
            onPointerDown={onVolumePointerDown}
            onWheel={(e) => nudgeVolume(e.deltaY < 0 ? 0.05 : -0.05)}>
            {!compact && <span className="player-vol-label">VOL</span>}
            <span className="player-vol-val">{volumePct}%</span>
          </span>

          <button className={`player-auto${loop ? ' on' : ''}`} aria-label="Loop"
            aria-pressed={loop} title="Loop the sample (Shift+L)"
            onClick={() => setLoop(!loop)}>
            <span className="player-auto-led" />
            {compact ? 'L' : 'LOOP'}
          </button>

          <button className={`player-auto${autoPreview ? ' on' : ''}`} aria-label="Auto-preview"
            aria-pressed={autoPreview} title="Auto-play a sample when you select it (Shift+Enter)"
            onClick={() => setAutoPreview(!autoPreview)}>
            <span className="player-auto-led" />
            {compact ? 'A' : 'AUTO'}
          </button>
        </>
      )}
    </div>
  )
}
