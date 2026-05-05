/**
 * Scored symbols list for Alpaca Search: pointer UX only; strings come from `src/trading/display`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { DOMElement } from "ink";

import { theme } from "../../theme.js";
import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "../../pointer/cellHit.js";
import type { AlpacaSearchScoredSymbol } from "../../../trading/types.js";
import {
  buildAlpacaScoredSymbolsTableHeader,
  buildAlpacaScoredSymbolRowViews,
} from "../../../trading/display/alpacaScoredSymbolsView.js";
import {
  TECHNICAL_POPOVER_COLUMN_HEADER_LINE,
  TECHNICAL_POPOVER_INSUFFICIENT_DATA_MESSAGE,
  buildTechnicalIndicatorDisplayRows,
  buildTechnicalPopoverSubtitle,
  technicalPopoverSeparatorDashCount,
} from "../../../trading/display/technicalBreakdownView.js";
import type { TechnicalScoreResult } from "../../../signal/technicalScore.js";

/** Shape of `useMouse()` from `@zenobius/ink-mouse` (events only). */
type AlpacaMouseApi = {
  events: {
    on(
      event: "click",
      handler: (pos: { x: number; y: number }, action: "press" | "release" | null) => void,
    ): void;
    off(
      event: "click",
      handler: (pos: { x: number; y: number }, action: "press" | "release" | null) => void,
    ): void;
    on(event: "position", handler: (pos: { x: number; y: number }) => void): void;
    off(event: "position", handler: (pos: { x: number; y: number }) => void): void;
  };
};

const POPOVER_BG = "#1e1e24";
const POPOVER_BORDER = "#3f3f46";

interface Props {
  candidates: AlpacaSearchScoredSymbol[];
  mouse: AlpacaMouseApi;
  techWeightPct: number;
  sentWeightPct: number;
  buyThreshold: number;
  sellThreshold: number;
}

export function AlpacaScoredSymbolsBlock({
  candidates,
  mouse,
  techWeightPct,
  sentWeightPct,
  buyThreshold,
  sellThreshold,
}: Props): React.ReactElement {
  const { stdout } = useStdout();
  const blockRef = useRef<DOMElement | null>(null);
  const techRefs = useRef<(DOMElement | null)[]>([]);
  const popoverRef = useRef<DOMElement | null>(null);
  const openedAtRef = useRef(0);
  const lastPressRef = useRef<{ t: number; row: number; x: number; y: number } | null>(null);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [popoverSymbol, setPopoverSymbol] = useState<string | null>(null);

  const viewport: TerminalViewport = {
    cols: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  };

  const tableHeader = useMemo(() => buildAlpacaScoredSymbolsTableHeader(), []);
  const rowViews = useMemo(
    () => buildAlpacaScoredSymbolRowViews(candidates, { buy: buyThreshold, sell: sellThreshold }),
    [candidates, buyThreshold, sellThreshold],
  );

  const assignTechRef = useCallback((i: number) => {
    return (el: DOMElement | null) => {
      techRefs.current[i] = el;
    };
  }, []);

  const clearBlurTimer = useCallback(() => {
    if (blurTimerRef.current !== undefined) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = undefined;
    }
  }, []);

  const scheduleClosePopover = useCallback(() => {
    clearBlurTimer();
    blurTimerRef.current = setTimeout(() => {
      setPopoverSymbol(null);
      blurTimerRef.current = undefined;
    }, 140);
  }, [clearBlurTimer]);

  useInput((_input, key) => {
    if (popoverSymbol && key.escape) {
      clearBlurTimer();
      setPopoverSymbol(null);
    }
  }, { isActive: Boolean(popoverSymbol) });

  useEffect(() => {
    const onClick = (pos: { x: number; y: number }, action: "press" | "release" | null) => {
      if (action !== "press") return;
      for (let i = 0; i < rowViews.length; i++) {
        const el = techRefs.current[i];
        if (!el) continue;
        const box = getTerminalCellBounds({ current: el });
        if (!box || !cellInsideBounds(box, pos.x, pos.y, viewport)) continue;

        const now = Date.now();
        const prev = lastPressRef.current;
        if (
          prev &&
          prev.row === i &&
          now - prev.t < 480 &&
          Math.abs(prev.x - pos.x) <= 2 &&
          Math.abs(prev.y - pos.y) <= 2
        ) {
          const sym = rowViews[i]?.symbol;
          if (sym) {
            openedAtRef.current = now;
            setPopoverSymbol(sym);
          }
          lastPressRef.current = null;
          return;
        }
        lastPressRef.current = { t: now, row: i, x: pos.x, y: pos.y };
        return;
      }
      lastPressRef.current = null;
    };

    mouse.events.on("click", onClick);
    return () => {
      mouse.events.off("click", onClick);
    };
  }, [mouse.events, rowViews, viewport.cols, viewport.rows]);

  useEffect(() => {
    const onMove = (pos: { x: number; y: number }) => {
      if (!popoverSymbol) return;
      if (Date.now() - openedAtRef.current < 200) return;

      const blockBox = blockRef.current ? getTerminalCellBounds(blockRef) : null;
      const insideBlock = blockBox ? cellInsideBounds(blockBox, pos.x, pos.y, viewport) : false;

      if (insideBlock) clearBlurTimer();
      else scheduleClosePopover();
    };

    mouse.events.on("position", onMove);
    return () => {
      mouse.events.off("position", onMove);
      clearBlurTimer();
    };
  }, [mouse.events, popoverSymbol, viewport, clearBlurTimer, scheduleClosePopover]);

  useEffect(() => {
    return () => clearBlurTimer();
  }, [clearBlurTimer]);

  const popoverCandidate = popoverSymbol ? candidates.find((c) => c.symbol === popoverSymbol) : undefined;
  const breakdown: TechnicalScoreResult | undefined = popoverCandidate?.technicalBreakdown;

  const breakdownRows = useMemo(
    () => (breakdown ? buildTechnicalIndicatorDisplayRows(breakdown) : []),
    [breakdown],
  );

  const popoverSubtitle = popoverCandidate
    ? buildTechnicalPopoverSubtitle(popoverCandidate.symbol, popoverCandidate.technicalScore)
    : "";

  const dashCount = technicalPopoverSeparatorDashCount(tableHeader, stdout.columns ?? 80);

  return (
    <Box ref={blockRef} flexDirection="column">
      <Text bold color={theme.color.primary}>
        Scored Symbols
      </Text>
      <Text color={theme.color.muted}>
        Sentiment / Technical / Final (w_s {sentWeightPct.toFixed(0)}% · w_t {techWeightPct.toFixed(0)}%) ·{" "}
        <Text color={theme.color.success}>+Pos</Text> · <Text color={theme.color.warn}>~Neu</Text> ·{" "}
        <Text color={theme.color.danger}>-Neg</Text>
      </Text>
      <Text color={theme.color.muted}>Double-click Technical to open breakdown · move away or Esc to close</Text>

      <Box marginTop={1} flexDirection="column">
        <Text bold color={theme.color.muted}>
          {tableHeader}
        </Text>
        <Text color={theme.color.muted}>{"─".repeat(tableHeader.length)}</Text>

        {rowViews.map((rv, i) => (
          <Box key={rv.symbol} flexDirection="row">
            <Text>
              {rv.padded.symbol} {rv.padded.price} {rv.padded.sentiment}{" "}
            </Text>
            <Box ref={assignTechRef(i)}>
              <Text color={theme.color.accent}>{rv.padded.technical}</Text>
            </Box>
            <Text>
              {" "}
              {rv.padded.final} {rv.padded.action} {rv.padded.rank} {rv.padded.news}
            </Text>
          </Box>
        ))}
      </Box>

      {popoverSymbol && popoverCandidate ? (
        <Box marginTop={0} flexDirection="column" alignItems="flex-start">
          <Box
            ref={popoverRef}
            flexDirection="column"
            borderStyle="round"
            borderColor={POPOVER_BORDER}
            backgroundColor={POPOVER_BG}
            paddingX={2}
            paddingY={1}
          >
            <Text bold color={theme.color.text}>
              Technical Score Results
            </Text>
            <Text bold color={theme.color.muted}>
              {popoverSubtitle}
            </Text>
            <Box marginY={1}>
              <Text color={theme.color.muted}>{TECHNICAL_POPOVER_COLUMN_HEADER_LINE}</Text>
              <Text color={POPOVER_BORDER}>{"─".repeat(dashCount)}</Text>
              {breakdown ? (
                breakdownRows.map((row) => (
                  <Box key={row.name} flexDirection="column" marginBottom={0}>
                    <Text bold color={theme.color.text}>
                      {row.name}
                    </Text>
                    <Text color={theme.color.muted}>{row.paddedMetricsLine}</Text>
                  </Box>
                ))
              ) : (
                <Text color={theme.color.muted}>{TECHNICAL_POPOVER_INSUFFICIENT_DATA_MESSAGE}</Text>
              )}
            </Box>
          </Box>
          <Box alignSelf="center" marginTop={0}>
            <Text color={theme.color.muted}>▼</Text>
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
