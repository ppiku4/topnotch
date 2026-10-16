import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from './bridge.js';

// The window ignores the mouse (forwarding moves only) until the pointer is
// over the island; then it captures clicks until the pointer has left.
// hold(true) keeps it open while a slider drag wanders outside the island;
// `pinned` keeps it open until close() is called. With expandOnHover off,
// hovering only makes the pill clickable; a click opens it.
export function useHoverPassthrough({ collapseDelay = 320, pinned = false, expandOnHover = true } = {}) {
  const [hovered, setHovered] = useState(false);
  const leaveTimer = useRef(null);
  const inside = useRef(false);
  const held = useRef(false);
  const pinnedRef = useRef(pinned);
  pinnedRef.current = pinned;
  const expandRef = useRef(expandOnHover);
  expandRef.current = expandOnHover;

  const clearLeave = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };

  const collapse = useCallback(() => {
    clearLeave();
    setHovered(false);
    bridge.setPassthrough(true);
  }, []);

  const scheduleCollapse = useCallback(() => {
    clearLeave();
    leaveTimer.current = setTimeout(() => {
      if (inside.current || held.current || pinnedRef.current) return;
      collapse();
    }, collapseDelay);
  }, [collapseDelay, collapse]);

  const onPointerEnter = useCallback(() => {
    inside.current = true;
    clearLeave();
    bridge.setPassthrough(false);
    if (expandRef.current) setHovered(true);
  }, []);

  const onClick = useCallback(() => {
    if (!expandRef.current) setHovered(true);
  }, []);

  const onPointerLeave = useCallback(() => {
    inside.current = false;
    scheduleCollapse();
  }, [scheduleCollapse]);

  const hold = useCallback((on) => {
    held.current = on;
    if (on) clearLeave();
    else if (!inside.current) scheduleCollapse();
  }, [scheduleCollapse]);

  // Unpinning while the pointer is elsewhere closes after the usual delay.
  useEffect(() => {
    if (!pinned && hovered && !inside.current) scheduleCollapse();
  }, [pinned, hovered, scheduleCollapse]);

  useEffect(() => bridge.onWindowBlur(() => {
    if (held.current || pinnedRef.current) return;
    inside.current = false;
    collapse();
  }), [collapse]);

  useEffect(() => clearLeave, []);

  const open = useCallback(() => {
    clearLeave();
    bridge.setPassthrough(false);
    setHovered(true);
  }, []);

  return { hovered, hold, open, close: collapse, handlers: { onPointerEnter, onPointerLeave, onClick } };
}
