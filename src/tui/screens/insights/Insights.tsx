/**
 * Insights container — composes the trading dashboard.
 *
 * Layout (top → bottom, scannable):
 *   1. Vital signs strip       (status, equity, 24h PnL, uptime, latency, sparkline)
 *   2. Agent session           (previous snapshot, next cycle, live step, reasoning)
 *   3. Performance | Positions (two-column risk + holdings)
 *   4. Market context          (focus symbol indicators + L1 book)
 *   5. System logs             (level-coloured feed)
 *
 * Focus symbol drives the Market context panel and is cycled with Tab/Shift-Tab.
 */

import React, { useEffect, useState } from "react";
import { Box, useInput } from "ink";

import { Footer, Header, ScreenFrame } from "../../components/Layout.js";
import { AgentActivity } from "./AgentActivity.js";
import { MarketContext } from "./MarketContext.js";
import { Performance } from "./Performance.js";
import { Positions } from "./Positions.js";
import { SystemLogs } from "./SystemLogs.js";
import { VitalSigns } from "./VitalSigns.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  onBack: () => void;
}

const LOG_VIEWPORT = 14;

export function Insights({ orchestrator, state, onBack }: Props): React.ReactElement {
  const [focusIdx, setFocusIdx] = useState(0);
  const [logScrollOffset, setLogScrollOffset] = useState(0);

  useEffect(() => {
    if (focusIdx >= state.watchlist.length) {
      setFocusIdx(0);
    }
  }, [state.watchlist.length, focusIdx]);

  const maxLogOffset = Math.max(0, state.logs.length - LOG_VIEWPORT);

  useEffect(() => {
    setLogScrollOffset((o) => Math.min(o, maxLogOffset));
  }, [maxLogOffset, state.logs.length]);

  useInput((input, key) => {
    if (key.escape || input === "h") {
      onBack();
      return;
    }
    if (input === "[") {
      setLogScrollOffset((o) => Math.min(o + 1, maxLogOffset));
      return;
    }
    if (input === "]") {
      setLogScrollOffset((o) => Math.max(0, o - 1));
      return;
    }
    if (input === "0") {
      setLogScrollOffset(0);
      return;
    }
    if (key.pageUp) {
      setLogScrollOffset((o) => Math.min(o + LOG_VIEWPORT, maxLogOffset));
      return;
    }
    if (key.pageDown) {
      setLogScrollOffset((o) => Math.max(0, o - LOG_VIEWPORT));
      return;
    }
    if (input === "n") {
      void orchestrator.runNow(state.watchlist[focusIdx]);
      return;
    }
    if (input === "p") {
      orchestrator.togglePause();
      return;
    }
    if (input === "r") {
      void orchestrator.pingNow();
      return;
    }
    if (key.tab && key.shift) {
      if (state.watchlist.length > 0) {
        setFocusIdx((i) => (i - 1 + state.watchlist.length) % state.watchlist.length);
      }
      return;
    }
    if (key.tab) {
      if (state.watchlist.length > 0) {
        setFocusIdx((i) => (i + 1) % state.watchlist.length);
      }
    }
  });

  const focusSymbol = state.watchlist[focusIdx] ?? null;

  return (
    <Box flexDirection="column">
      <Header
        breadcrumb={["Insights", focusSymbol ?? "(no symbol)"]}
        brokerName={state.brokerName}
        connected={state.connected}
      />
      <ScreenFrame
        title="Insights"
        subtitle="At-a-glance trading dashboard. Updates as the orchestrator cycles."
      >
        <VitalSigns state={state} />
        <AgentActivity state={state} />
        <Box>
          <Box width="50%" flexDirection="column">
            <Performance metrics={state.performance} />
          </Box>
          <Box width={1} />
          <Box width="50%" flexDirection="column">
            <Positions
              positions={state.positions}
              config={orchestrator.config}
              equity={state.account?.equity ?? null}
            />
          </Box>
        </Box>
        <MarketContext broker={orchestrator.broker} symbol={focusSymbol} />
        <SystemLogs logs={state.logs} scrollOffset={logScrollOffset} viewportLines={LOG_VIEWPORT} />
      </ScreenFrame>
      <Footer
        hints={[
          "Tab cycle symbol",
          "n run agent now (focus symbol)",
          "[ / ] log older / newer",
          "PgUp/PgDn log page",
          "0 newest logs",
          "p pause/resume",
          "r ping",
          "h home",
          "Esc back",
        ]}
      />
    </Box>
  );
}
