import { AudioPreview, formatTime } from '../hooks/useAudioPreview'
import './SamplePlayerBar.css'

interface Props {
  player: AudioPreview
  playable: boolean
}

export function SamplePlayerBar({ player, playable }: Props) {
  const { isPlaying, currentTime, duration, activeName, error, volume, autoPreview,
    togglePlay, seek, setVolume, setAutoPreview } = player
  const canPlay = playable && !error
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const volumePct = Math.round(volume * 100)

  // Wheel over the volume control nudges by 5%, clamped to [0, 1].
  const onVolumeWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const next = Math.min(1, Math.max(0, volume + (e.deltaY < 0 ? 0.05 : -0.05)))
    setVolume(Math.round(next * 100) / 100)
  }

  return (
    <div className="sample-player-bar">
      <button className="player-play-btn" aria-label={isPlaying ? 'Pause' : 'Play'}
        title={isPlaying ? 'Pause' : 'Play'} disabled={!canPlay} onClick={togglePlay}>
        <i className={isPlaying ? 'fas fa-pause' : 'fas fa-play'} />
      </button>

      <span className="player-name" title={error ? "Can't play this file" : (activeName || 'No sample selected')}>
        {error ? "Can't play" : (activeName || 'No sample selected')}
      </span>

      <div className="player-seek-track" title="Seek through the sample">
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

      <div className="player-volume" aria-label="Volume" role="slider"
        aria-valuenow={volumePct} aria-valuemin={0} aria-valuemax={100}
        title="Volume (scroll to adjust)" onWheel={onVolumeWheel}>
        <span className="player-vol-label">VOL</span>
        <span className="player-vol-value">{volumePct}%</span>
      </div>

      <button className={`player-auto${autoPreview ? ' active' : ''}`} aria-label="Auto-preview"
        aria-pressed={autoPreview} title="Auto-play a sample when you select it"
        onClick={() => setAutoPreview(!autoPreview)}>
        Auto
      </button>
    </div>
  )
}
