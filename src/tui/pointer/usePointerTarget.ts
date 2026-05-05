/**
 * Pointer hit-testing that matches Ink layout (see `cellHit.ts`).
 * Recomputes bounds on pointer move / click so layout stays correct after reflow.
 *
 * **Throttling:** `position` events fire at high frequency while the mouse moves.
 * Every subscriber previously ran `getTerminalCellBounds` on each event; with many
 * rows, tabs, and selects this could saturate the main thread and make the TUI feel
 * frozen. We coalesce moves to a fixed interval and skip `setHover` when unchanged.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { useStdout, type DOMElement } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "./cellHit.js";

type MousePosition = { x: number; y: number };

/** ms between hover hit-tests while the pointer is in motion */
const POINTER_MOVE_THROTTLE_MS = 45;

export interface UsePointerTargetOptions {
  disabled?: boolean;
  /** Called once per successful press inside the bounds (after 1-based → layout fix). */
  onPress?: () => void;
  /** Ripple / flash duration in ms (terminal “press” affordance). */
  rippleMs?: number;
}

export interface PointerTargetState {
  hover: boolean;
  /** Short-lived after a successful press (visual ripple). */
  ripple: boolean;
}

export function usePointerTarget(
  ref: RefObject<DOMElement | null>,
  options: UsePointerTargetOptions = {},
): PointerTargetState {
  const { disabled = false, onPress, rippleMs = 140 } = options;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const mouse = useMouse();
  const { stdout } = useStdout();
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = {
    cols: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  };
  const [hover, setHover] = useState(false);
  const [ripple, setRipple] = useState(false);
  const rippleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const hoverCache = useRef(false);
  const moveThrottleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latestPos = useRef<MousePosition | null>(null);

  const flashRipple = useCallback(() => {
    if (rippleTimer.current) clearTimeout(rippleTimer.current);
    setRipple(true);
    rippleTimer.current = setTimeout(() => {
      setRipple(false);
      rippleTimer.current = undefined;
    }, rippleMs);
  }, [rippleMs]);

  useEffect(() => {
    return () => {
      if (rippleTimer.current) clearTimeout(rippleTimer.current);
      if (moveThrottleTimer.current) clearTimeout(moveThrottleTimer.current);
    };
  }, []);

  const applyHoverFromPosition = useCallback(
    (pos: MousePosition) => {
      const box = getTerminalCellBounds(ref);
      if (!box) return;
      const next = cellInsideBounds(box, pos.x, pos.y, viewportRef.current);
      if (next === hoverCache.current) return;
      hoverCache.current = next;
      setHover(next);
    },
    [ref],
  );

  useEffect(() => {
    if (disabled) {
      hoverCache.current = false;
      setHover(false);
      return;
    }

    const flushMove = (): void => {
      moveThrottleTimer.current = undefined;
      const pos = latestPos.current;
      if (pos == null) return;
      applyHoverFromPosition(pos);
    };

    const onMove = (pos: MousePosition) => {
      latestPos.current = pos;
      if (moveThrottleTimer.current != null) return;
      moveThrottleTimer.current = setTimeout(flushMove, POINTER_MOVE_THROTTLE_MS);
    };

    mouse.events.on("position", onMove);
    return () => {
      mouse.events.off("position", onMove);
      if (moveThrottleTimer.current) {
        clearTimeout(moveThrottleTimer.current);
        moveThrottleTimer.current = undefined;
      }
    };
  }, [applyHoverFromPosition, disabled, mouse.events, ref, stdout.columns, stdout.rows]);

  useEffect(() => {
    if (disabled) return;
    const onClick = (pos: MousePosition, action: "press" | "release" | null) => {
      if (action !== "press") return;
      const box = getTerminalCellBounds(ref);
      if (!box || !cellInsideBounds(box, pos.x, pos.y, viewportRef.current)) return;
      flashRipple();
      onPressRef.current?.();
    };
    mouse.events.on("click", onClick);
    return () => {
      mouse.events.off("click", onClick);
    };
  }, [disabled, flashRipple, mouse.events, ref, stdout.columns, stdout.rows]);

  return { hover: disabled ? false : hover, ripple: disabled ? false : ripple };
}
