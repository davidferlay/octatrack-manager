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

  const center = size / 2;
  const radius = (size - 4) / 2;
  const strokeWidth = 2;

  // Arc calculations (270 degrees, from 135° to 405°)
  const startAngleDeg = 135;
  const totalArc = 270;

  // Hand indicator angle
  const handAngleDeg = startAngleDeg + (normalizedValue * totalArc);
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Background arc path
  const bgStartX = center + radius * Math.cos(toRad(startAngleDeg));
  const bgStartY = center + radius * Math.sin(toRad(startAngleDeg));
  const bgEndX = center + radius * Math.cos(toRad(startAngleDeg + totalArc));
  const bgEndY = center + radius * Math.sin(toRad(startAngleDeg + totalArc));
  const bgPath = `M ${bgStartX} ${bgStartY} A ${radius} ${radius} 0 1 1 ${bgEndX} ${bgEndY}`;

  // Hand indicator end point
  const handLength = radius - 3;
  const handEndX = center + handLength * Math.cos(toRad(handAngleDeg));
  const handEndY = center + handLength * Math.sin(toRad(handAngleDeg));

  const isEditable = !disabled && onChange;

  return (
    <svg
      ref={knobRef}
      className={`rotary-knob ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${isEditable ? 'editable' : ''} ${isFocused ? 'focused' : ''}`}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
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
      {/* Background arc track */}
      <path
        className="knob-track"
        d={bgPath}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />

      {/* Clock-style hand indicator */}
      <line
        className="knob-hand"
        x1={center}
        y1={center}
        x2={handEndX}
        y2={handEndY}
        strokeWidth={2}
        strokeLinecap="round"
      />

      {/* Center dot */}
      <circle
        className="knob-center"
        cx={center}
        cy={center}
        r={3}
      />
    </svg>
  );
}
