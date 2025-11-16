import { formatTrackName } from '../utils/trackUtils';
import './TrackBadge.css';

interface TrackBadgeProps {
  trackId: number;  // 0-15 (0-7 = Audio, 8-15 = MIDI)
  className?: string;  // Additional CSS classes
}

/**
 * Displays a track name badge with appropriate color coding
 * - Audio tracks (0-7): Blue badge
 * - MIDI tracks (8-15): Green badge
 */
export function TrackBadge({ trackId, className = '' }: TrackBadgeProps) {
  const trackType = trackId < 8 ? 'audio' : 'midi';
  const trackTypeLabel = trackId < 8 ? 'Audio Track' : 'MIDI Track';
  const combinedClassName = `pattern-track-indicator track-badge ${trackType} ${className}`.trim();

  return (
    <span className={combinedClassName} title={trackTypeLabel}>
      {formatTrackName(trackId)}
    </span>
  );
}
