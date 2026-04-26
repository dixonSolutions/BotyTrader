/**
 * Pointer hit-testing that matches Ink layout (see `cellHit.ts`).
 * Recomputes bounds on every move/click so layout stays correct after reflow.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { useStdout, type DOMElement } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "./cellHit.js";

type MousePosition = { x: number; y: number };

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

/**
 * Subscribes to ink-mouse stream and hit-tests with fresh yoga bounds each time.
 */
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

  const flashRipple = useCallback(() => {
    if (rippleTimer.current) clearTimeout(rippleTimer.current);
    setRipple(true);
    rippleTimer.current = setTimeout(() => {
      setRipple(false);
      rippleTimer.current = undefined;
    }, rippleMs);
  }, [rippleMs]);

  useEffect(() => () => rippleTimer.current && clearTimeout(rippleTimer.current), []);

  useEffect(() => {
    if (disabled) {
      setHover(false);
      return;
    }
    const onMove = (pos: MousePosition) => {
      const box = getTerminalCellBounds(ref);
      if (!box) return;
      setHover(cellInsideBounds(box, pos.x, pos.y, viewportRef.current));
    };
    mouse.events.on("position", onMove);
    return () => {
      mouse.events.off("position", onMove);
    };
  }, [disabled, mouse.events, ref, stdout.columns, stdout.rows]);

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
