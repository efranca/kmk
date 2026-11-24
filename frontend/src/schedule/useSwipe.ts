import { useRef, type TouchEvent } from "react";

const MIN_DISTANCE = 60; // px sideways before it counts as a swipe
const MAX_MS = 800;

/**
 * Swipe handlers for a touch screen: a quick sideways move calls `onNext` (finger moved left) or `onPrev` (moved right).
 * A mostly vertical move is scrolling and is ignored, and so is one that starts on an event (that is dragged instead).
 */
export function useSwipe(onPrev: () => void, onNext: () => void) {
  const start = useRef<{ x: number; y: number; at: number } | null>(null);
  return {
    onTouchStart(e: TouchEvent) {
      const t = e.touches[0];
      const onEvent = e.target instanceof Element && e.target.closest(".grid__event");
      start.current = e.touches.length === 1 && t && !onEvent ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
    },
    onTouchEnd(e: TouchEvent) {
      const s = start.current;
      const t = e.changedTouches[0];
      start.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Date.now() - s.at > MAX_MS || Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onNext(); else onPrev();
    },
    onTouchCancel() { start.current = null; },
  };
}
