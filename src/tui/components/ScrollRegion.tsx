/**
 * Virtual viewport for tall screen bodies: wheel / trackpad scroll moves content,
 * optional ASCII scrollbar; keep header/footer outside this region.
 */

import { useMouse } from "@zenobius/ink-mouse";
import type { DOMElement } from "ink";
import { Box, Text, useStdout } from "ink";
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { theme } from "../theme.js";

const WHEEL_STEP = 3;

export interface ScrollRegionProps {
  children: React.ReactNode;
  /** When false, no gutter column (still scrolls). */
  showScrollbar?: boolean;
}

export function ScrollRegion({ children, showScrollbar = true }: ScrollRegionProps): React.ReactElement {
  const mouse = useMouse();
  const { stdout } = useStdout();
  const [scroll, setScroll] = useState(0);
  const [viewH, setViewH] = useState(12);
  const [maxScroll, setMaxScroll] = useState(0);
  const outerRef = useRef<DOMElement>(null);
  const innerRef = useRef<DOMElement>(null);
  const maxScrollRef = useRef(0);

  const syncLayout = useCallback(() => {
    const outer = outerRef.current?.yogaNode;
    const inner = innerRef.current?.yogaNode;
    if (!outer || !inner) return;
    const v = Math.max(1, Math.round(outer.getComputedHeight()));
    const innerH = Math.max(v, Math.round(inner.getComputedHeight()));
    const max = Math.max(0, innerH - v);
    maxScrollRef.current = max;
    setViewH(v);
    setMaxScroll(max);
    setScroll((s) => (max === 0 ? 0 : Math.min(Math.max(0, s), max)));
  }, []);

  useLayoutEffect(() => {
    syncLayout();
  }, [children, stdout.columns, stdout.rows, syncLayout]);

  useEffect(() => {
    const onScroll = (_pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === "scrollup") {
        setScroll((s) => Math.max(0, s - WHEEL_STEP));
      } else if (dir === "scrolldown") {
        setScroll((s) => Math.min(maxScrollRef.current, s + WHEEL_STEP));
      }
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events]);

  const innerH = viewH + maxScroll;
  const thumbH = maxScroll === 0 ? viewH : Math.max(1, Math.round((viewH * viewH) / Math.max(innerH, 1)));
  const thumbStart =
    maxScroll === 0 ? 0 : Math.round((scroll / Math.max(maxScroll, 1)) * Math.max(0, viewH - thumbH));
  const barLines: string[] = [];
  for (let i = 0; i < viewH; i++) {
    barLines.push(i >= thumbStart && i < thumbStart + thumbH ? "█" : "░");
  }
  const barText = barLines.join("\n");

  return (
    <Box flexDirection="row" flexGrow={1} minHeight={0} minWidth={0} ref={outerRef}>
      <Box flexDirection="column" flexGrow={1} minWidth={0} minHeight={0} overflow="hidden">
        <Box marginTop={-scroll} ref={innerRef} flexDirection="column">
          {children}
        </Box>
      </Box>
      {showScrollbar && maxScroll > 0 ? (
        <Box flexDirection="column" width={1} flexShrink={0} marginLeft={0}>
          <Text color={theme.color.muted}>{barText}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
