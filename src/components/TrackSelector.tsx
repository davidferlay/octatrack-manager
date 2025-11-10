interface TrackSelectorProps {
  id: string;
  value: number;
  onChange: (trackIndex: number) => void;
  currentTrack?: number;
}

export function TrackSelector({ id, value, onChange, currentTrack }: TrackSelectorProps) {
  return (
    <div className="selector-group">
      <label htmlFor={id} className="bank-selector-label">
        Track:
      </label>
      <select
        id={id}
        className="bank-selector"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <optgroup label="Audio Tracks">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((trackNum) => (
            <option key={`audio-${trackNum}`} value={trackNum}>
              T{trackNum + 1} (Audio){trackNum === currentTrack ? ' (Active)' : ''}
            </option>
          ))}
        </optgroup>
        <optgroup label="MIDI Tracks">
          {[8, 9, 10, 11, 12, 13, 14, 15].map((trackNum) => (
            <option key={`midi-${trackNum}`} value={trackNum}>
              T{trackNum - 7} (MIDI){trackNum === currentTrack ? ' (Active)' : ''}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
