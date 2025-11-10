interface PatternSelectorProps {
  id: string;
  value: number;
  onChange: (patternIndex: number) => void;
  currentPattern?: number;
}

// Special value for "all patterns" option
export const ALL_PATTERNS = -1;

export function PatternSelector({ id, value, onChange, currentPattern }: PatternSelectorProps) {
  return (
    <div className="selector-group">
      <label htmlFor={id} className="bank-selector-label">
        Pattern:
      </label>
      <select
        id={id}
        className="bank-selector"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        <option value={ALL_PATTERNS}>All Patterns</option>
        {[...Array(16)].map((_, patternNum) => (
          <option key={patternNum} value={patternNum}>
            Pattern {patternNum + 1}{patternNum === currentPattern ? ' (Active)' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}
