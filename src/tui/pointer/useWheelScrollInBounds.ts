/**
 * Wheel delta while the pointer is inside `ref` (Ink cell grid). Used for
 * virtualized tables without relying on every ScrollRegion receiving scroll.
 */

import { useMouse } from "@zenobius/ink-mouse";
import type { DOMElement } from "ink";
import { useStdout } from "ink";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "./cellHit.js";

const DEFAULT_STEP = 3;

export function useWheelScrollInBounds(
  ref: RefObject<DOMElement | null>,
  maxScroll: number,
  step: number = DEFAULT_STEP,
): number {
  const mouse = useMouse();
  const { stdout } = useStdout();
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = {
    cols: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  };
  const [scrollTop, setScrollTop] = useState(0);
  const maxRef = useRef(maxScroll);
  maxRef.current = maxScroll;

  useEffect(() => {
    setScrollTop((s) => Math.min(s, maxScroll));
  }, [maxScroll]);

  const onScroll = useCallback(
    (pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null) return;
      const box = getTerminalCellBounds(ref);
      if (!box || !cellInsideBounds(box, pos.x, pos.y, viewportRef.current)) return;
      const max = maxRef.current;
      setScrollTop((s) => {
        if (dir === "scrollup") return Math.max(0, s - step);
        return Math.min(max, s + step);
      });
    },
    [ref, step],
  );

  useEffect(() => {
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, onScroll]);

  return scrollTop;
}
