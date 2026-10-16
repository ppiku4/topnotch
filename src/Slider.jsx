import { useRef, useState } from 'react';

// Pointer-driven 0..1 slider. onChange fires while dragging (live controls),
// onCommit once on release (seeking).
export default function Slider({ value, onChange, onCommit, onDragChange, className = '', label }) {
  const trackRef = useRef(null);
  const [dragValue, setDragValue] = useState(null);
  const shown = dragValue ?? value ?? 0;

  const valueAt = (clientX) => {
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const next = valueAt(e.clientX);
    setDragValue(next);
    onDragChange?.(true);
    onChange?.(next);
  };

  const onPointerMove = (e) => {
    if (dragValue === null) return;
    const next = valueAt(e.clientX);
    setDragValue(next);
    onChange?.(next);
  };

  const finish = (e) => {
    if (dragValue === null) return;
    const next = valueAt(e.clientX);
    setDragValue(null);
    onDragChange?.(false);
    onCommit?.(next);
  };

  return (
    <div
      ref={trackRef}
      className={`slider${dragValue !== null ? ' is-dragging' : ''} ${className}`}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(shown * 100)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div className="slider-track">
        <div className="slider-fill" style={{ transform: `scaleX(${shown})` }} />
      </div>
      <div className="slider-thumb" style={{ left: `${shown * 100}%` }} />
    </div>
  );
}
