import { useRef, useCallback, useEffect, useState } from 'react';
import './RotaryKnob.css';

interface RotaryKnobProps {
  value: number;
  min?: number;
  max?: number;
  size?: number;
  onChange?: (value: number) => void;
  onChangeEnd?: (value: number) => void; // Called on mouse release
  disabled?: boolean;
}

export function RotaryKnob({
  value,
  min = 0,
  max = 127,
  size = 36,
  onChange,
  onChangeEnd,
  disabled = false,
}: RotaryKnobProps) {
  const knobRef = useRef<SVGSVGElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartValue = useRef<number>(0);
  const currentValue = useRef<number>(value);
  const valueChanged = useRef<boolean>(false);

  const normalizedValue = (value - min) / (max - min);

  // Keep currentValue in sync
  useEffect(() => {
    currentValue.current = value;
  }, [value]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled || !onChange) return;
    e.preventDefault();
    knobRef.current?.focus();
    setIsDragging(true);
    dragStartY.current = e.clientY;
    dragStartValue.current = value;
    currentValue.current = value;
    valueChanged.current = false;
  }, [disabled, onChange, value]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !onChange) return;

    const deltaY = dragStartY.current - e.clientY;
    const sensitivity = (max - min) / 100;
    const newValue = Math.round(
      Math.max(min, Math.min(max, dragStartValue.current + deltaY * sensitivity))
    );

    if (newValue !== currentValue.current) {
      currentValue.current = newValue;
      valueChanged.current = true;
      onChange(newValue);
    }
  }, [isDragging, onChange, min, max]);

  const handleMouseUp = useCallback(() => {
    if (isDragging && onChangeEnd && valueChanged.current) {
      onChangeEnd(currentValue.current);
    }
    setIsDragging(false);
  }, [isDragging, onChangeEnd]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (disabled || !onChange) return;

    let newValue = value;
    const step = e.shiftKey ? 10 : 1;

    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        e.preventDefault();
        newValue = Math.min(max, value + step);
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        e.preventDefault();
        newValue = Math.max(min, value - step);
        break;
      case 'Home':
        e.preventDefault();
        newValue = min;
        break;
      case 'End':
        e.preventDefault();
        newValue = max;
        break;
      case 'PageUp':
        e.preventDefault();
        newValue = Math.min(max, value + 10);
        break;
      case 'PageDown':
        e.preventDefault();
        newValue = Math.max(min, value - 10);
        break;
      default:
        return;
    }

    if (newValue !== value) {
      onChange(newValue);
      // For keyboard, save immediately after each change
      onChangeEnd?.(newValue);
    }
  }, [disabled, onChange, onChangeEnd, value, min, max]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Corner bracket dimensions
  const cornerPadding = 4; // Space outside the knob for corners
  const cornerLength = 6;
  const totalSize = size + cornerPadding * 2;

  // Knob center is offset by cornerPadding
  const center = cornerPadding + size / 2;
  const radius = (size - 4) / 2;
  const trackStrokeWidth = 2;
  const handStrokeWidth = 2;

  // Arc calculations (290 degrees, from 125° to 415°)
  const startAngleDeg = 125;
  const totalArc = 290;

  // Hand indicator angle
  const handAngleDeg = startAngleDeg + (normalizedValue * totalArc);
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Arc start and end points
  const bgStartX = center + radius * Math.cos(toRad(startAngleDeg));
  const bgStartY = center + radius * Math.sin(toRad(startAngleDeg));
  const bgEndX = center + radius * Math.cos(toRad(startAngleDeg + totalArc));
  const bgEndY = center + radius * Math.sin(toRad(startAngleDeg + totalArc));

  // Value arc path (from start to current value position)
  const valueEndX = center + radius * Math.cos(toRad(handAngleDeg));
  const valueEndY = center + radius * Math.sin(toRad(handAngleDeg));
  const valueArcDeg = normalizedValue * totalArc;
  const largeArcFlag = valueArcDeg > 180 ? 1 : 0;
  const valuePath = normalizedValue > 0.001
    ? `M ${bgStartX} ${bgStartY} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${valueEndX} ${valueEndY}`
    : '';

  // Hand indicator - single line from center to circle edge
  const handLength = radius; // Stops at the circle edge (inside the gap)
  const handEndX = center + handLength * Math.cos(toRad(handAngleDeg));
  const handEndY = center + handLength * Math.sin(toRad(handAngleDeg));

  // Gap in the circle just after the hand position (in the direction of higher values)
  const gapAngleDeg = 13; // Gap size in degrees

  // Gap starts at the hand position and extends in the positive direction
  const gapStartAngle = handAngleDeg;
  const gapEndAngle = handAngleDeg + gapAngleDeg;

  // Clamp gap angles to arc bounds
  const arcStart = startAngleDeg;
  const arcEnd = startAngleDeg + totalArc;

  // Calculate the two track segments (avoiding the gap)
  const track1End = Math.max(arcStart, Math.min(gapStartAngle, arcEnd));
  const track2Start = Math.max(arcStart, Math.min(gapEndAngle, arcEnd));

  // Track segment 1 path (from arc start to gap start)
  const track1EndX = center + radius * Math.cos(toRad(track1End));
  const track1EndY = center + radius * Math.sin(toRad(track1End));
  const track1ArcDeg = track1End - arcStart;
  const track1LargeArc = track1ArcDeg > 180 ? 1 : 0;
  const track1Path = track1ArcDeg > 1
    ? `M ${bgStartX} ${bgStartY} A ${radius} ${radius} 0 ${track1LargeArc} 1 ${track1EndX} ${track1EndY}`
    : '';

  // Track segment 2 path (from gap end to arc end)
  const track2StartX = center + radius * Math.cos(toRad(track2Start));
  const track2StartY = center + radius * Math.sin(toRad(track2Start));
  const track2ArcDeg = arcEnd - track2Start;
  const track2LargeArc = track2ArcDeg > 180 ? 1 : 0;
  const track2Path = track2ArcDeg > 1
    ? `M ${track2StartX} ${track2StartY} A ${radius} ${radius} 0 ${track2LargeArc} 1 ${bgEndX} ${bgEndY}`
    : '';

  const isEditable = !disabled && onChange;

  return (
    <svg
      ref={knobRef}
      className={`rotary-knob ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${isEditable ? 'editable' : ''} ${isFocused ? 'focused' : ''}`}
      width={totalSize}
      height={totalSize}
      viewBox={`0 0 ${totalSize} ${totalSize}`}
      onMouseDown={handleMouseDown}
      onKeyDown={handleKeyDown}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      tabIndex={0}
      role="slider"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      {/* Selection corner brackets */}
      {isFocused && isEditable && (
        <g className="knob-corners">
          {/* Top-left corner */}
          <path d={`M 1 ${1 + cornerLength} L 1 1 L ${1 + cornerLength} 1`} />
          {/* Top-right corner */}
          <path d={`M ${totalSize - 1 - cornerLength} 1 L ${totalSize - 1} 1 L ${totalSize - 1} ${1 + cornerLength}`} />
          {/* Bottom-left corner */}
          <path d={`M 1 ${totalSize - 1 - cornerLength} L 1 ${totalSize - 1} L ${1 + cornerLength} ${totalSize - 1}`} />
          {/* Bottom-right corner */}
          <path d={`M ${totalSize - 1 - cornerLength} ${totalSize - 1} L ${totalSize - 1} ${totalSize - 1} L ${totalSize - 1} ${totalSize - 1 - cornerLength}`} />
        </g>
      )}

      {/* Background arc track segment 1 (before gap) */}
      {track1Path && (
        <path
          className="knob-track"
          d={track1Path}
          fill="none"
          strokeWidth={trackStrokeWidth}
          strokeLinecap="round"
        />
      )}

      {/* Background arc track segment 2 (after gap) */}
      {track2Path && (
        <path
          className="knob-track"
          d={track2Path}
          fill="none"
          strokeWidth={trackStrokeWidth}
          strokeLinecap="round"
        />
      )}

      {/* Value arc (blue fill) */}
      {valuePath && (
        <path
          className="knob-value"
          d={valuePath}
          fill="none"
          strokeWidth={trackStrokeWidth}
          strokeLinecap="round"
        />
      )}

      {/* Hand indicator - single line from center to beyond circle */}
      <line
        className="knob-hand"
        x1={center}
        y1={center}
        x2={handEndX}
        y2={handEndY}
        strokeWidth={handStrokeWidth}
        strokeLinecap="round"
      />

    </svg>
  );
}
